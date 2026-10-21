"use strict";

/**
 * Harness conductual de límites de uso (T34.2). Framework-neutral: el
 * adapter conecta el handler HTTP real (con su limitador) en proceso; el
 * limitador debe usar `clock.now()` para medir la ventana.
 *
 *   createApiUnderTest({ clock, deps }) → { handle({ method, path, query, headers, body, ip }) → Promise<{ status, headers, body }> }
 *
 * Identidades sintéticas: `x-api-key: kclient-a|b`, `ip: 203.0.113.10|20` o
 * `authorization: Bearer kuser-a|b`, según `by`.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { call } = require("../shared/http.js");
const { MAX_LIMITS, MAX_REQUESTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-rate-limit-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);

function identity(by, who) {
  if (by === "api-key") return { headers: { "x-api-key": `kclient-${who}` } };
  if (by === "user") return { headers: { authorization: `Bearer kuser-${who}` } };
  return { ip: who === "a" ? "203.0.113.10" : "203.0.113.20", headers: {} };
}

async function runScenario(l, factory) {
  const id = `limit@${l.id}`;
  if (l.limit + 1 > MAX_REQUESTS) return { id, status: "skipped", limitation: "LIMIT_TOO_LARGE", steps: [] };
  const clock = createVirtualClock(T0);
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps: {} });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const send = (who) => {
    const idn = identity(l.by, who);
    return call(sut, { method: l.method, path: l.path, ...idn, headers: { ...idn.headers } }, clock);
  };
  const windowMs = l.windowSeconds * 1000;
  const gap = Math.max(1, Math.floor(windowMs / (2 * (l.limit + 1))));
  let step;
  try {
    let underLimitOk = true;
    for (let i = 0; i < l.limit; i += 1) {
      const r = await send("a");
      if (!r || r.status === 429 || r.status === 0) underLimitOk = false;
      await advanceTo(clock, clock.now() + gap);
    }
    const over = await send("a");
    const limited = !!over && over.status === 429;
    const ra = over ? Number(over.headers["retry-after"]) : NaN;
    const retryAfterOk = limited && Number.isFinite(ra) && ra >= 1 && ra <= l.windowSeconds;
    const other = await send("b");
    const perClient = !!other && other.status !== 429 && other.status !== 0;
    await advanceTo(clock, T0 + windowMs + 2000 + l.limit * gap);
    const again = await send("a");
    const windowReset = !!again && again.status !== 429 && again.status !== 0;
    step = { underLimitOk, limited, retryAfterOk, perClient, windowReset };
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const l of (params.limits || []).slice(0, MAX_LIMITS)) scenarios.push(await runScenario(l, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
