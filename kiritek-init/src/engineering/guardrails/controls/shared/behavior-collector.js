"use strict";

/**
 * Collector común de los controles con contrato + harness conductual
 * (T18–T21). Observa; no decide:
 *
 *  1. contrato declarado → observación determinista (válido o no, con hechos);
 *  2. sin contrato → señales HEURÍSTICAS (sólo piden evidencia);
 *  3. con contrato válido, harness y momento PR/release → corre el harness
 *     DOS veces; cada escenario es `complete` si ambas corridas coinciden,
 *     `conflict` si difieren y `partial`/`timeout` si no terminó.
 *
 * Nunca contacta servicios reales: el harness inyecta reloj y transporte.
 */

const fs = require("node:fs");
const path = require("node:path");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");
const { canonicalJson } = require("../../canonical.js");
const { runTool, RUN_STATUS } = require("../../runtime/runner.js");
const { isFastMoment } = require("./moments.js");

const RUNNER = path.join(__dirname, "harness-runner.js");
const ENV_VAR = "KIRITEK_HARNESS_PARAMS";

function parseTrace(text, traceSchema) {
  let trace;
  try {
    trace = JSON.parse(text);
  } catch (_) {
    return { failure: "TRACE_PARSE" };
  }
  if (!validateAgainst(traceSchema, trace, { extended: true }).valid) return { failure: "TRACE_SCHEMA" };
  if (trace.fatal) return { failure: trace.fatal };
  return { trace };
}

async function runHarnessOnce(ctx, spec, harness, params, timeoutMs) {
  const sourceEnv = { PATH: process.env.PATH, [ENV_VAR]: JSON.stringify(params) };
  const common = { repoRoot: ctx.repoRoot, cwd: ctx.unit.root, sourceEnv, envAllowlist: [ENV_VAR], timeoutMs };
  let run;
  if (harness.kind === "node-adapter") {
    const adapter = containReal(ctx.repoRoot, harness.adapter);
    if (!adapter.contained || !fs.existsSync(adapter.realPath)) return { failure: "ADAPTER_NOT_FOUND" };
    run = await runTool({ command: process.execPath, args: [RUNNER, spec.harnessModule, spec.factory, adapter.realPath], ...common });
    if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
    if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
    return parseTrace(run.stdout, spec.traceSchema);
  }
  run = await runTool({ command: harness.command, args: harness.args, ...common });
  if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
  if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
  const traceFile = containReal(ctx.repoRoot, harness.traceFile);
  if (!traceFile.contained || !fs.existsSync(traceFile.realPath)) return { failure: "TRACE_NOT_FOUND" };
  return parseTrace(fs.readFileSync(traceFile.realPath, "utf8"), spec.traceSchema);
}

/**
 * @param {object} spec
 * @param {string} spec.id, spec.version, spec.paramName, spec.label
 * @param {string} spec.contractKind, spec.behaviorKind, spec.runKind, spec.signalsKind
 * @param {string} spec.traceSchema, spec.harnessModule, spec.factory
 * @param {(repoRoot, relPath) => object} spec.load      → {declared, valid, errorCodes, doc?, facts?}
 * @param {(facts, parameters) => object|null} spec.harnessParams  null ⇒ sin pruebas conductuales
 * @param {(ctx) => object} spec.scanSignals
 */
function makeCollector(spec) {
  async function collect(ctx) {
    const p = ctx.parameters;
    const loaded = spec.load(ctx.repoRoot, p[spec.paramName]);
    const out = [
      {
        kind: spec.contractKind,
        mechanism: "schema",
        status: "complete",
        confidence: "deterministic",
        evidenceClass: "deterministic",
        ...(loaded.declared && loaded.valid ? { locationRef: p[spec.paramName] } : {}),
        facts: { declared: loaded.declared, valid: loaded.valid, errorCodes: loaded.errorCodes, ...(loaded.facts ? { contract: loaded.facts } : {}) },
      },
    ];
    if (!loaded.declared) {
      out.push({ kind: spec.signalsKind, mechanism: "static-analysis", status: "complete", confidence: "low", evidenceClass: "heuristic", facts: spec.scanSignals(ctx) });
      return out;
    }
    const harness = loaded.valid ? loaded.doc.harness : null;
    const params = harness ? spec.harnessParams(loaded.facts, p) : null;
    if (!params || isFastMoment(ctx.moment)) return out;

    const timeoutMs = Math.max(1000, Math.floor((ctx.budgetMs || 120000) / 2.5));
    const first = await runHarnessOnce(ctx, spec, harness, params, timeoutMs);
    if (first.failure) {
      out.push({
        kind: spec.runKind,
        mechanism: "runtime",
        status: first.timeout ? "timeout" : "unavailable",
        confidence: "unknown",
        evidenceClass: "deterministic",
        facts: { failure: first.failure },
        limitations: [{ code: first.failure, message: `el harness de ${spec.label} no produjo evidencia (${first.failure})` }],
      });
      return out;
    }
    const second = await runHarnessOnce(ctx, spec, harness, params, timeoutMs);
    const twin = new Map(((second.trace && second.trace.scenarios) || []).map((s) => [s.id, s]));
    for (const sc of first.trace.scenarios) {
      if (sc.status === "skipped") continue;
      const base = { kind: spec.behaviorKind, mechanism: "test", evidenceClass: "deterministic", facts: { scenario: sc.id, harness: first.trace.harness, params, steps: sc.steps } };
      const other = twin.get(sc.id);
      if (sc.status !== "ok") {
        out.push({ ...base, status: sc.status === "timeout" ? "timeout" : "partial", confidence: "medium", limitations: [{ code: sc.limitation || "SCENARIO_ERROR", message: `el escenario ${sc.id} no terminó correctamente` }] });
      } else if (!other || other.status !== "ok" || canonicalJson(other.steps) !== canonicalJson(sc.steps)) {
        out.push({ ...base, status: "conflict", confidence: "high", limitations: [{ code: "FLAKY_SCENARIO", message: `el escenario ${sc.id} no es reproducible entre ejecuciones` }] });
      } else {
        out.push({ ...base, status: "complete", confidence: "deterministic" });
      }
    }
    return out;
  }
  return { id: spec.id, version: spec.version, collect };
}

module.exports = { makeCollector, parseTrace, ENV_VAR };
