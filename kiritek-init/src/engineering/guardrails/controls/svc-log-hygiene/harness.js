"use strict";

/**
 * Harness conductual de logs (T38.2). Framework-neutral: el adapter conecta
 * el servidor real en proceso y dirige la salida de su logger (pino,
 * winston, slog…) a `logger.write(line)`.
 *
 *   createServiceUnderTest({
 *     clock,
 *     deps,    // { dependency() → Promise } — falla en el escenario `error`
 *     logger,  // { write(line) } — destino del logger del servicio (una línea por evento)
 *   }) → { handle({ method, path, query, headers, body, ip }) → Promise<{ status, headers, body }> }
 *
 * Las requests llevan datos personales y secretos canario en cuerpo, headers
 * y query. La traza sólo dice si aparecieron, nunca las líneas.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { call } = require("../shared/http.js");
const { SCENARIOS, MAX_ENDPOINTS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-logs-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const CANARY = Object.freeze({
  email: "kcanary.persona@example.test",
  phone: "+56 9 4444 0000",
  card: "4111111111111111",
  token: "kcanary-tok-9f8e7d6c5b4a",
  password: "kcanary-Passw0rd!",
});
const REQUEST_ID = "kreq-0001";

const has = (lines, needle) => lines.some((l) => l.includes(needle));
const cardLike = (lines) => lines.some((l) => /4111[ -]?1111[ -]?1111[ -]?1111/.test(l));
const phoneLike = (lines) => lines.some((l) => /\+?56[ -]?9[ -]?4444[ -]?0000/.test(l));

function parse(line) {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch (_) {
    return null;
  }
}

const get = (obj, dotted) => dotted.split(".").reduce((acc, k) => (acc && typeof acc === "object" ? acc[k] : undefined), obj);
const isError = (v) => (typeof v === "string" ? ["error", "fatal", "critical", "err"].includes(v.toLowerCase()) : typeof v === "number" && v >= 50);

async function runScenario(e, scenario, factory, p) {
  const id = `${scenario}@${e.id}`;
  const clock = createVirtualClock(T0);
  const lines = [];
  const logger = { write: (line) => void lines.push(String(line).replace(/\n$/, "")) };
  const failing = scenario === "error";
  const deps = {
    dependency: async () => {
      if (failing) throw Object.assign(new Error(`connection refused (user ${CANARY.email}, token ${CANARY.token})`), { code: "ECONNREFUSED" });
      return { ok: true };
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps, logger });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const body = {
    ...(e.sampleBody ? JSON.parse(JSON.stringify(e.sampleBody)) : {}),
    email: CANARY.email,
    phone: CANARY.phone,
    cardNumber: CANARY.card,
    password: CANARY.password,
  };
  const req = (headers = {}) => ({
    method: e.method,
    path: e.path,
    query: { email: CANARY.email },
    headers: { "content-type": "application/json", authorization: `Bearer ${CANARY.token}`, cookie: `session=${CANARY.token}`, ...headers },
    ...(e.method === "GET" || e.method === "DELETE" ? {} : { body }),
  });
  const parsed = () => lines.map(parse);
  let step;
  try {
    if (scenario === "structured") {
      await call(sut, req(), clock);
      const objs = parsed();
      step = { logged: lines.length > 0, structured: lines.length > 0 && objs.every((o) => o && get(o, p.fields.level) !== undefined && get(o, p.fields.message) !== undefined) };
    } else if (scenario === "correlation") {
      await call(sut, req({ [p.correlationHeader]: REQUEST_ID }), clock);
      const first = parsed();
      const propagated = first.length > 0 && first.every((o) => o && get(o, p.fields.requestId) === REQUEST_ID);
      lines.length = 0;
      await call(sut, req(), clock);
      const second = parsed();
      const ids = new Set(second.map((o) => (o ? get(o, p.fields.requestId) : undefined)));
      const [only] = [...ids];
      step = { propagated, generated: second.length > 0 && ids.size === 1 && typeof only === "string" && only.length > 0 && only !== REQUEST_ID };
    } else if (scenario === "no-pii") {
      await call(sut, req(), clock);
      step = { noEmail: !has(lines, CANARY.email), noPhone: !phoneLike(lines), noCard: !cardLike(lines), noToken: !has(lines, CANARY.token), noPassword: !has(lines, CANARY.password) };
    } else {
      await call(sut, req(), clock);
      const objs = parsed();
      step = { errorLogged: objs.some((o) => o && isError(get(o, p.fields.level))) || lines.some((l) => /\berror\b/i.test(l) && !parse(l)), noSecrets: !has(lines, CANARY.token) && !has(lines, CANARY.password), noPii: !has(lines, CANARY.email) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const e of (params.endpoints || []).slice(0, MAX_ENDPOINTS)) for (const s of SCENARIOS) scenarios.push(await runScenario(e, s, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, CANARY, REQUEST_ID, runSuite, runScenario };
