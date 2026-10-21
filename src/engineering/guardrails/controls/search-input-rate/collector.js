"use strict";

/**
 * Collector de `search.input-rate` (T10.2). Observa; no decide.
 *
 * 1. Contrato conductual (`parameters.behaviorContract`): observación
 *    determinista de su presencia/validez (sin copiar contenido).
 * 2. Con contrato válido y búsqueda remota/costosa: ejecuta el harness en un
 *    proceso hijo aislado (runtime T07) DOS veces; trazas distintas ⇒
 *    escenarios en `conflict` (flaky), nunca evidencia apta para deny.
 * 3. Sin contrato: sólo señales estáticas heurísticas (máximo warn).
 */

const fs = require("node:fs");
const path = require("node:path");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");
const { canonicalJson } = require("../../canonical.js");
const { runTool, RUN_STATUS } = require("../../runtime/runner.js");
const { loadBehaviorContract } = require("./contract.js");
const { scanSignals } = require("./signals.js");
const { isFastMoment } = require("../shared/moments.js");
const { REQUIRED_SCENARIOS } = require("./scenarios.js");

const ID = "search-input-rate/collector";
const VERSION = "1.0.0";
const RUNNER = path.join(__dirname, "harness-runner.js");
const TRACE_SCHEMA = "engineering/controls/search-input-rate.trace";

function harnessParams(parameters, contract) {
  return {
    minChars: parameters.minChars,
    windowMs: parameters.cadence.windowMs,
    strategy: parameters.cadence.strategy,
    dedupeWindowMs: parameters.dedupeWindowMs,
    cancellation: contract.cancellation,
    equivalence: contract.equivalence,
  };
}

async function runHarnessOnce(ctx, contract, params, timeoutMs) {
  const env = { PATH: process.env.PATH, KIRITEK_SEARCH_PARAMS: JSON.stringify(params) };
  const cwd = ctx.unit.root;
  if (contract.harness.kind === "node-adapter") {
    const adapter = containReal(ctx.repoRoot, contract.harness.adapter);
    if (!adapter.contained || !fs.existsSync(adapter.realPath)) return { failure: "ADAPTER_NOT_FOUND" };
    const run = await runTool({ command: process.execPath, args: [RUNNER, adapter.realPath], repoRoot: ctx.repoRoot, cwd, sourceEnv: env, envAllowlist: ["KIRITEK_SEARCH_PARAMS"], timeoutMs });
    if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
    if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
    return parseTrace(run.stdout);
  }
  const run = await runTool({ command: contract.harness.command, args: contract.harness.args, repoRoot: ctx.repoRoot, cwd, sourceEnv: env, envAllowlist: ["KIRITEK_SEARCH_PARAMS"], timeoutMs });
  if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
  if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
  const traceFile = containReal(ctx.repoRoot, contract.harness.traceFile);
  if (!traceFile.contained || !fs.existsSync(traceFile.realPath)) return { failure: "TRACE_NOT_FOUND" };
  return parseTrace(fs.readFileSync(traceFile.realPath, "utf8"));
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

function runObservation(code, status) {
  return {
    kind: "search-harness-run",
    mechanism: "runtime",
    status,
    confidence: "unknown",
    evidenceClass: "deterministic",
    facts: { failure: code },
    limitations: [{ code, message: `el harness conductual no produjo evidencia (${code})` }],
  };
}

async function collect(ctx) {
  const p = ctx.parameters;
  const loaded = loadBehaviorContract(ctx.repoRoot, p.behaviorContract);
  const out = [];
  out.push({
    kind: "search-contract",
    mechanism: "schema",
    status: "complete",
    confidence: "deterministic",
    evidenceClass: "deterministic",
    ...(loaded.declared && loaded.valid ? { locationRef: p.behaviorContract } : {}),
    facts: {
      declared: loaded.declared,
      valid: loaded.valid,
      errorCodes: loaded.errorCodes,
      ...(loaded.contract
        ? {
            triggers: loaded.contract.triggers,
            cancellation: loaded.contract.cancellation,
            equivalence: loaded.contract.equivalence,
            harnessKind: loaded.contract.harness.kind,
            minCharsException: !!loaded.contract.minCharsException,
          }
        : {}),
    },
  });

  if (!loaded.declared) {
    const s = scanSignals(ctx.repoRoot, ctx.unit.root);
    out.push({ kind: "search-signals", mechanism: "static-analysis", status: "complete", confidence: "low", evidenceClass: "heuristic", facts: s });
    return out;
  }
  if (!loaded.valid || loaded.contract.triggers === "local" || isFastMoment(ctx.moment)) return out;

  const params = harnessParams(p, loaded.contract);
  const timeoutMs = Math.max(1000, Math.floor((ctx.budgetMs || 120000) / 2.5));
  const first = await runHarnessOnce(ctx, loaded.contract, params, timeoutMs);
  if (first.failure) {
    out.push(runObservation(first.failure, first.timeout ? "timeout" : "unavailable"));
    return out;
  }
  const second = await runHarnessOnce(ctx, loaded.contract, params, timeoutMs);
  const byId = (trace) => new Map(trace.scenarios.map((s) => [s.id, s]));
  const a = byId(first.trace);
  const b = second.trace ? byId(second.trace) : new Map();

  for (const id of REQUIRED_SCENARIOS) {
    const sc = a.get(id);
    if (!sc) continue;
    const base = {
      kind: "search-behavior",
      mechanism: "test",
      evidenceClass: "deterministic",
      facts: {
        scenario: id,
        harness: first.trace.harness,
        params,
        minCharsException: !!loaded.contract.minCharsException,
        events: sc.events,
      },
    };
    const twin = b.get(id);
    if (sc.status !== "ok") {
      out.push({ ...base, status: sc.status === "timeout" ? "timeout" : "partial", confidence: "medium", limitations: [{ code: sc.limitation || "SCENARIO_ERROR", message: `el escenario ${id} no terminó correctamente` }] });
    } else if (!twin || twin.status !== "ok" || canonicalJson(twin.events) !== canonicalJson(sc.events)) {
      out.push({ ...base, status: "conflict", confidence: "high", limitations: [{ code: "FLAKY_SCENARIO", message: `el escenario ${id} no es reproducible entre ejecuciones (reloj/transporte no controlados)` }] });
    } else {
      out.push({ ...base, status: "complete", confidence: "deterministic" });
    }
  }
  return out;
}

module.exports = { id: ID, version: VERSION, collect };
