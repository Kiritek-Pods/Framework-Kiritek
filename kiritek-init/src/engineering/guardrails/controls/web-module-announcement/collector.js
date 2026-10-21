"use strict";

/**
 * Collector de `web.module-announcement` (T12). Observa; no decide.
 * Nunca contacta canales remotos: el harness corre con storage, reloj,
 * viewer y mensajes sintéticos.
 */

const fs = require("node:fs");
const path = require("node:path");
const { containReal } = require("../../../../platform/paths.js");
const { validateAgainst } = require("../../../../domain/schema-validator.js");
const { canonicalJson } = require("../../canonical.js");
const { runTool, RUN_STATUS } = require("../../runtime/runner.js");
const { loadLaunchManifest } = require("./manifest.js");
const { scanSignals } = require("./signals.js");
const { isFastMoment } = require("../shared/moments.js");

const ID = "web-module-announcement/collector";
const VERSION = "1.0.0";
const RUNNER = path.join(__dirname, "harness-runner.js");
const TRACE_SCHEMA = "engineering/controls/web-module-announcement.trace";
const ENV_VAR = "KIRITEK_ANNOUNCE_PARAMS";
/** Ratio mínimo para texto normal según el estándar adoptado (AA). */
const CONTRAST_MIN = { "WCAG-2.1-AA": 4.5, "WCAG-2.2-AA": 4.5 };

/** Anuncio cuya política se prueba: el primero no retirado (o el primero). */
function announcementUnderTest(facts) {
  return facts.announcements.find((a) => a.rollout.state !== "retired") || facts.announcements[0] || null;
}

/** Parámetros del harness derivados de manifest + config (sin contenido). */
function harnessParams(parameters, facts) {
  const a = announcementUnderTest(facts);
  return {
    audienceScope: a.showOnce.audienceScope,
    periodDays: a.showOnce.periodDays,
    storageUnavailable: a.showOnce.storageUnavailable,
    missingContent: a.content.missingContent,
    animated: a.animated,
    contrastMin: CONTRAST_MIN[parameters.accessibilityStandard || "WCAG-2.2-AA"],
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

async function runHarnessOnce(ctx, harness, params, timeoutMs) {
  const sourceEnv = { PATH: process.env.PATH, [ENV_VAR]: JSON.stringify(params) };
  const common = { repoRoot: ctx.repoRoot, cwd: ctx.unit.root, sourceEnv, envAllowlist: [ENV_VAR], timeoutMs };
  let run;
  if (harness.kind === "node-adapter") {
    const adapter = containReal(ctx.repoRoot, harness.adapter);
    if (!adapter.contained || !fs.existsSync(adapter.realPath)) return { failure: "ADAPTER_NOT_FOUND" };
    run = await runTool({ command: process.execPath, args: [RUNNER, adapter.realPath], ...common });
    if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
    if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
    return parseTrace(run.stdout);
  }
  run = await runTool({ command: harness.command, args: harness.args, ...common });
  if (run.status === RUN_STATUS.TIMEOUT) return { failure: "HARNESS_TIMEOUT", timeout: true };
  if (run.status !== RUN_STATUS.OK) return { failure: "HARNESS_FAILED" };
  const traceFile = containReal(ctx.repoRoot, harness.traceFile);
  if (!traceFile.contained || !fs.existsSync(traceFile.realPath)) return { failure: "TRACE_NOT_FOUND" };
  return parseTrace(fs.readFileSync(traceFile.realPath, "utf8"));
}

async function collect(ctx) {
  const p = ctx.parameters;
  const loaded = loadLaunchManifest(ctx.repoRoot, p.launchManifest);
  const out = [
    {
      kind: "announcement-manifest",
      mechanism: "schema",
      status: "complete",
      confidence: "deterministic",
      evidenceClass: "deterministic",
      ...(loaded.declared && loaded.valid ? { locationRef: p.launchManifest } : {}),
      facts: { declared: loaded.declared, valid: loaded.valid, errorCodes: loaded.errorCodes, ...(loaded.facts ? { manifest: loaded.facts } : {}) },
    },
  ];
  if (!loaded.declared) {
    out.push({ kind: "announcement-signals", mechanism: "static-analysis", status: "complete", confidence: "low", evidenceClass: "heuristic", facts: scanSignals((ctx.scope && ctx.scope.paths) || []) });
    return out;
  }
  if (!loaded.valid || !loaded.manifest.harness || !announcementUnderTest(loaded.facts) || isFastMoment(ctx.moment)) return out;

  const params = harnessParams(p, loaded.facts);
  const timeoutMs = Math.max(1000, Math.floor((ctx.budgetMs || 120000) / 2.5));
  const first = await runHarnessOnce(ctx, loaded.manifest.harness, params, timeoutMs);
  if (first.failure) {
    out.push({
      kind: "announcement-harness-run",
      mechanism: "runtime",
      status: first.timeout ? "timeout" : "unavailable",
      confidence: "unknown",
      evidenceClass: "deterministic",
      facts: { failure: first.failure },
      limitations: [{ code: first.failure, message: `el harness de anuncios no produjo evidencia (${first.failure})` }],
    });
    return out;
  }
  const second = await runHarnessOnce(ctx, loaded.manifest.harness, params, timeoutMs);
  const twin = new Map(((second.trace && second.trace.scenarios) || []).map((s) => [s.id, s]));
  for (const sc of first.trace.scenarios) {
    if (sc.status === "skipped") continue;
    const base = { kind: "announcement-behavior", mechanism: "test", evidenceClass: "deterministic", facts: { scenario: sc.id, harness: first.trace.harness, params, steps: sc.steps } };
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

module.exports = { id: ID, version: VERSION, collect, harnessParams, announcementUnderTest };
