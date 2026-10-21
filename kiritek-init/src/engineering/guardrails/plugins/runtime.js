"use strict";

/**
 * Implementaciones de controles de plugin (T15B.2, T15B.3). El código del
 * plugin NUNCA corre en el proceso del motor:
 *  - collectors: proceso hijo vía `runTool` (cwd confinado, env sólo con las
 *    variables declaradas, temporal privado, timeout) bajo el sandbox de
 *    permisos + guard de red;
 *  - evaluator: proceso hijo síncrono, sin escritura ni red; su salida se
 *    valida y un `blockingEligible` (o cualquier campo de decisión del core)
 *    se rechaza: mayDeny siempre lo recalcula el core.
 * Un fallo queda aislado en su control (observación `unavailable` o
 * EVALUATOR_*), sin afectar a los demás.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runTool, RUN_STATUS } = require("../runtime/runner.js");
const { EvaluatorError } = require("../pipeline/evaluate.js");
const { RUNNER, sandboxArgs } = require("./permissions.js");

// Holgado: arrancar un proceso aislado puede tardar bajo carga; un timeout
// es error operativo (nunca deny) y no cambia la semántica.
const EVALUATE_TIMEOUT_MS = 20000;
const FORBIDDEN_RESULT_KEYS = ["blockingEligible", "mayDeny", "suppressed", "level", "state"];

function failedObservation(code, status = "unavailable") {
  return [{ kind: "plugin-run", mechanism: "runtime", status, confidence: "unknown", evidenceClass: "deterministic", facts: { failure: code }, limitations: [{ code, message: `el plugin no produjo evidencia (${code})` }] }];
}

function collectorFor(plugin, control, collectorId, repoRoot) {
  const pluginDir = path.join(repoRoot, ...plugin.root.split("/"));
  const entry = path.join(pluginDir, ...plugin.entry.split("/"));
  return {
    id: collectorId,
    version: plugin.version,
    async collect(ctx) {
      let argsFor;
      try {
        sandboxArgs({ pluginDir, repoRoot });
        argsFor = (tempDir) => [...sandboxArgs({ pluginDir, repoRoot, readGlobs: control.permissions.filesystemRead, tempDir }), RUNNER, entry, "collect", collectorId];
      } catch (err) {
        return failedObservation(err.code || "PLUGIN_SANDBOX_UNAVAILABLE");
      }
      const payload = { moment: ctx.moment, repoRoot, unit: ctx.unit, controlId: ctx.controlId, parameters: ctx.parameters, scope: { paths: (ctx.scope && ctx.scope.paths) || [] } };
      const sourceEnv = { PATH: process.env.PATH, KIRITEK_PLUGIN_CTX: JSON.stringify(payload), KIRITEK_PLUGIN_NET_ALLOW: control.permissions.networkHosts.join(",") };
      for (const name of control.permissions.envNames) if (process.env[name] !== undefined) sourceEnv[name] = process.env[name];
      const run = await runTool({
        command: process.execPath,
        args: argsFor,
        repoRoot,
        cwd: ctx.unit.root,
        sourceEnv,
        envAllowlist: ["KIRITEK_PLUGIN_CTX", "KIRITEK_PLUGIN_NET_ALLOW", ...control.permissions.envNames],
        network: control.permissions.networkHosts.length > 0,
        timeoutMs: Math.max(1000, Math.min(control.timeoutMs, ctx.budgetMs || control.timeoutMs)),
      });
      if (run.status === RUN_STATUS.TIMEOUT) return failedObservation("PLUGIN_TIMEOUT", "timeout");
      let reply;
      try {
        reply = JSON.parse(run.stdout);
      } catch (_) {
        return failedObservation(run.status === RUN_STATUS.OK ? "PLUGIN_OUTPUT_INVALID" : "PLUGIN_CRASHED");
      }
      if (!reply.ok) return failedObservation(reply.code || "PLUGIN_FAILED");
      if (!Array.isArray(reply.observations)) return failedObservation("PLUGIN_OUTPUT_INVALID");
      return reply.observations;
    },
  };
}

function evaluatorFor(plugin, control, repoRoot) {
  const pluginDir = path.join(repoRoot, ...plugin.root.split("/"));
  const entry = path.join(pluginDir, ...plugin.entry.split("/"));
  return {
    version: plugin.version,
    evaluate(input) {
      let args;
      try {
        args = [...sandboxArgs({ pluginDir, repoRoot }), RUNNER, entry, "evaluate", control.id];
      } catch (err) {
        throw new EvaluatorError("PLUGIN_SANDBOX_UNAVAILABLE", err.message);
      }
      const res = spawnSync(process.execPath, args, { input: JSON.stringify(input), encoding: "utf8", timeout: EVALUATE_TIMEOUT_MS, env: { PATH: process.env.PATH }, maxBuffer: 1024 * 1024, cwd: pluginDir });
      if (res.error && res.error.code === "ETIMEDOUT") throw new EvaluatorError("PLUGIN_TIMEOUT", "el evaluator del plugin excedió su tiempo");
      let reply;
      try {
        reply = JSON.parse(res.stdout);
      } catch (_) {
        throw new EvaluatorError("PLUGIN_OUTPUT_INVALID", "salida del evaluator del plugin ilegible");
      }
      if (!reply.ok) throw new EvaluatorError(reply.code || "PLUGIN_FAILED", "el evaluator del plugin falló");
      const r = reply.result;
      const leaked = r && typeof r === "object" ? [...Object.keys(r), ...(Array.isArray(r.findings) ? r.findings.flatMap((f) => (f && typeof f === "object" ? Object.keys(f) : [])) : [])].filter((k) => FORBIDDEN_RESULT_KEYS.includes(k)) : [];
      if (leaked.length) throw new EvaluatorError("PLUGIN_FORBIDDEN_FIELD", `el plugin intentó fijar ${[...new Set(leaked)].join(", ")}: lo decide el core`);
      return r;
    },
  };
}

/** Normalizer genérico: facts como objeto JSON plano (la privacidad la aplica el pipeline). */
const pluginNormalizer = {
  version: "1.0.0",
  normalize(facts) {
    if (!facts || typeof facts !== "object" || Array.isArray(facts) || JSON.stringify(facts).length > 64 * 1024) {
      throw Object.assign(new Error("facts"), { code: "NORMALIZATION" });
    }
    return facts;
  },
};

/** @returns {Record<string, object>} implementaciones por id de control. */
function pluginImplementations(snapshot, { repoRoot }) {
  const out = {};
  for (const plugin of snapshot.plugins || []) {
    for (const controlId of plugin.controls) {
      const control = snapshot.catalog.controls.find((c) => c.id === controlId);
      out[controlId] = {
        collectors: control.collectors.map((id) => collectorFor(plugin, control, id, repoRoot)),
        normalizer: pluginNormalizer,
        evaluator: evaluatorFor(plugin, control, repoRoot),
      };
    }
  }
  return out;
}

module.exports = { pluginImplementations, FORBIDDEN_RESULT_KEYS };
