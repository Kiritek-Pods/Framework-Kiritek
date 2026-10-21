"use strict";

/**
 * Ejecución de collectors (T06.1–T06.2).
 *
 * Los collectors observan; no reciben nivel, evaluator ni decisiones. Se
 * ejecutan en orden estable por id, cada uno bajo timeout. Un fallo o
 * timeout se preserva como resultado explícito (luego observación
 * `unavailable`/`timeout`); nunca se fabrica un valor. El mensaje de error
 * del collector no se propaga (puede contener datos), sólo su código.
 */

const { deepFreeze } = require("../contracts/common.js");

const COLLECTOR_STATUS = Object.freeze({ OK: "ok", ERROR: "error", TIMEOUT: "timeout" });

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {{id, version, collect: (ctx) => any}[]} collectors
 * @param {object} ctx           Contexto de observación (se congela).
 * @param {object} opts
 * @param {number} opts.timeoutMs
 * @param {() => number} [opts.nowMs]
 * @returns {Promise<{collectorId, version, status, raw, durationMs, errorCode?}[]>}
 */
async function runCollectors(collectors, ctx, opts) {
  const nowMs = opts.nowMs || Date.now;
  const frozen = deepFreeze(JSON.parse(JSON.stringify(ctx)));
  const ordered = [...collectors].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const results = [];
  for (const collector of ordered) {
    const started = nowMs();
    let outcome;
    try {
      outcome = await withTimeout(Promise.resolve().then(() => collector.collect(frozen)), opts.timeoutMs);
    } catch (err) {
      results.push({
        collectorId: collector.id,
        version: collector.version,
        status: COLLECTOR_STATUS.ERROR,
        raw: [],
        durationMs: Math.max(0, nowMs() - started),
        errorCode: typeof (err && err.code) === "string" && /^[A-Z0-9_]+$/.test(err.code) ? err.code : "COLLECTOR_ERROR",
      });
      continue;
    }
    const durationMs = Math.max(0, nowMs() - started);
    if (outcome && outcome.__timeout) {
      results.push({ collectorId: collector.id, version: collector.version, status: COLLECTOR_STATUS.TIMEOUT, raw: [], durationMs });
      continue;
    }
    results.push({
      collectorId: collector.id,
      version: collector.version,
      status: COLLECTOR_STATUS.OK,
      raw: Array.isArray(outcome) ? outcome : outcome === undefined || outcome === null ? [] : [outcome],
      durationMs,
    });
  }
  return results;
}

module.exports = { COLLECTOR_STATUS, runCollectors };
