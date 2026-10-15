"use strict";

/**
 * Collector de `app.minimum-supported-version` (T11). Observa; no decide.
 * Nunca contacta la fuente remota real de la política: la indisponibilidad
 * de red durante el análisis no puede convertirse en incumplimiento (R10.12).
 */

const fs = require("node:fs");
const path = require("node:path");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");
const { canonicalJson } = require("../../canonical.js");
const { runTool, RUN_STATUS } = require("../../runtime/runner.js");
const { loadPolicyContract } = require("./contract.js");
const { scanSignals } = require("./signals.js");
const { isFastMoment } = require("../shared/moments.js");

const ID = "app-minimum-supported-version/collector";
const VERSION = "1.0.0";
const RUNNER = path.join(__dirname, "harness-runner.js");
const TRACE_SCHEMA = "engineering/controls/app-minimum-supported-version.trace";
const ENV_VAR = "KIRITEK_VERSION_PARAMS";

/** Parámetros del harness derivados de contrato + config (sin secretos). */
function harnessParams(parameters, facts) {
  const wanted = (parameters.environments || [])[0];
  const env = facts.environments.find((e) => e.name === wanted) || facts.environments[0];
  const mobile = facts.stores.find((s) => s.platform !== "enterprise") || facts.stores[0];
  return {
    environment: env.name,
    cacheTtlSeconds: env.cacheTtlSeconds,
    staleIfOfflineSeconds: env.staleIfOfflineSeconds,
    timeoutMs: env.timeoutMs,
    platform: mobile.platform,
    enterprise: facts.stores.some((s) => s.platform === "enterprise"),
  };
}

function parseTrace(text) {
  let trace;
  try {
    trace = JSON.parse(text);
  } catch (_) {
    return { failure: "TRACE_PARSE" };
  }
  if (!validateAgainst(TRACE_SCHEMA, trace, { extended: true }).valid) return { failure: "TRACE_SCHEMA" };
  if (trace.fatal) return { failure: trace.fatal };
  return { trace };
}

async function runHarnessOnce(ctx, contract, params, timeoutMs) {
  const sourceEnv = { PATH: process.env.PATH, [ENV_VAR]: JSON.stringify(params) };
  const common = { repoRoot: ctx.repoRoot, cwd: ctx.unit.root, sourceEnv, envAllowlist: [ENV_VAR], timeoutMs };
  let run;
  if (contract.harness.kind === "node-adapter") {
    const adapter = containReal(ctx.repoRoot, contract.harness.adapter);
    if (!adapter.contained || !fs.existsSync(adapter.realPath)) return { failure: "ADAPTER_NOT_FOUND" };
    run = await runTool({ command: process.execPath, args: [RUNNER, adapter.realPath], ...common });
    if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
    if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
    return parseTrace(run.stdout);
  }
  run = await runTool({ command: contract.harness.command, args: contract.harness.args, ...common });
  if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
  if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
  const traceFile = containReal(ctx.repoRoot, contract.harness.traceFile);
  if (!traceFile.contained || !fs.existsSync(traceFile.realPath)) return { failure: "TRACE_NOT_FOUND" };
  return parseTrace(fs.readFileSync(traceFile.realPath, "utf8"));
}

async function collect(ctx) {
  const p = ctx.parameters;
  const loaded = loadPolicyContract(ctx.repoRoot, p.policyContract);
  const out = [
    {
      kind: "version-contract",
      mechanism: "schema",
      status: "complete",
      confidence: "deterministic",
      evidenceClass: "deterministic",
      ...(loaded.declared && loaded.valid ? { locationRef: p.policyContract } : {}),
      facts: { declared: loaded.declared, valid: loaded.valid, errorCodes: loaded.errorCodes, ...(loaded.facts ? { contract: loaded.facts } : {}) },
    },
  ];
  if (!loaded.declared) {
    out.push({ kind: "version-signals", mechanism: "static-analysis", status: "complete", confidence: "low", evidenceClass: "heuristic", facts: scanSignals(ctx.repoRoot, ctx.unit.root) });
    return out;
  }
  if (!loaded.valid || isFastMoment(ctx.moment)) return out;

  const params = harnessParams(p, loaded.facts);
  const timeoutMs = Math.max(1000, Math.floor((ctx.budgetMs || 120000) / 2.5));
  const first = await runHarnessOnce(ctx, loaded.contract, params, timeoutMs);
  if (first.failure) {
    out.push({
      kind: "version-harness-run",
      mechanism: "runtime",
      status: first.timeout ? "timeout" : "unavailable",
      confidence: "unknown",
      evidenceClass: "deterministic",
      facts: { failure: first.failure },
      limitations: [{ code: first.failure, message: `el harness de versión mínima no produjo evidencia (${first.failure})` }],
    });
    return out;
  }
  const second = await runHarnessOnce(ctx, loaded.contract, params, timeoutMs);
  const twin = new Map(((second.trace && second.trace.scenarios) || []).map((s) => [s.id, s]));
  for (const sc of first.trace.scenarios) {
    if (sc.status === "skipped") continue;
    const base = { kind: "version-behavior", mechanism: "test", evidenceClass: "deterministic", facts: { scenario: sc.id, harness: first.trace.harness, params, decisions: sc.decisions } };
    const other = twin.get(sc.id);
    if (sc.status !== "ok") {
      out.push({ ...base, status: sc.status === "timeout" ? "timeout" : "partial", confidence: "medium", limitations: [{ code: sc.limitation || "SCENARIO_ERROR", message: `el escenario ${sc.id} no terminó correctamente` }] });
    } else if (!other || other.status !== "ok" || canonicalJson(other.decisions) !== canonicalJson(sc.decisions)) {
      out.push({ ...base, status: "conflict", confidence: "high", limitations: [{ code: "FLAKY_SCENARIO", message: `el escenario ${sc.id} no es reproducible entre ejecuciones` }] });
    } else {
      out.push({ ...base, status: "complete", confidence: "deterministic" });
    }
  }
  return out;
}

module.exports = { id: ID, version: VERSION, collect, harnessParams };
