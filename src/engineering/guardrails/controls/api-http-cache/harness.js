"use strict";

/**
 * Harness conductual de caché HTTP (T42.2). Framework-neutral: el adapter
 * conecta el handler de lectura real; su repositorio lee de `deps.store` y
 * la identidad sale de `deps.auth`:
 *
 *   createApiUnderTest({ clock, deps: {
 *     store: { read(user) → Promise<{ id, name, updatedAt }> },  // user null en recursos públicos
 *     auth: { userOf(headers) → string | null },                 // Authorization: Bearer <usuario>
 *   } }) → { handle({ method, path, query, headers }) → Promise<{ status, headers, body }> }
 *
 * En recursos privados cada usuario tiene su propio registro. La traza sólo
 * dice qué se cumplió, nunca headers ni cuerpos.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { call, is2xx } = require("../shared/http.js");
const { scenariosFor, MAX_RESOURCES } = require("./scenarios.js");

const HARNESS = { name: "kiritek-api-http-cache-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const USERS = ["kuser-a", "kuser-b"];
const UPDATED = new Date(T0 - 86400000).toISOString();

/** Directivas de Cache-Control como mapa (`max-age` → "300", `private` → true). */
function directives(value) {
  const out = {};
  for (const part of String(value || "").split(",")) {
    const [k, v] = part.trim().toLowerCase().split("=");
    if (k) out[k] = v === undefined ? true : v.replace(/"/g, "");
  }
  return out;
}

const empty = (r) => r.body === undefined || r.body === null || r.body === "" || r.text === "" || r.text === "null";

async function runScenario(r, scenario, factory) {
  const id = `${scenario}@${r.id}`;
  const clock = createVirtualClock(T0);
  const rows = new Map(USERS.map((u) => [u, { id: `${r.id}-1`, name: r.visibility === "private" ? `kval-${u}` : "kval-publico", updatedAt: UPDATED }]));
  const keyOf = (user) => (r.visibility === "private" ? user : USERS[0]);
  const deps = {
    store: { read: async (user) => ({ ...(rows.get(keyOf(user)) || {}) }) },
    auth: { userOf: (headers) => (/^Bearer (kuser-[ab])$/.exec(String((headers || {}).authorization || "")) || [])[1] || null },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, deps });
    if (!sut || typeof sut.handle !== "function") throw new Error("sin handle()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const get = (user, extra = {}) => call(sut, { method: "GET", path: r.path, headers: { authorization: `Bearer ${user}`, ...extra } }, clock);
  const validatorOf = (res) => {
    if (!res) return undefined;
    const v = r.validator === "etag" ? res.headers.etag : res.headers["last-modified"];
    if (!v) return undefined;
    return r.validator === "etag" || !Number.isNaN(Date.parse(v)) ? v : undefined;
  };
  const conditional = (v) => (v === undefined ? {} : r.validator === "etag" ? { "if-none-match": v } : { "if-modified-since": v });
  let step;
  try {
    if (scenario === "headers") {
      const res = await get(USERS[0]);
      const cc = res ? res.headers["cache-control"] : undefined;
      const d = directives(cc);
      const maxAge = d["s-maxage"] !== undefined ? d["s-maxage"] : d["max-age"];
      step = {
        ok: !!res && is2xx(res.status),
        hasCacheControl: !!cc,
        maxAgeOk: !cc || r.visibility === "private" || (Number(maxAge) === r.maxAgeSeconds && !d["no-store"] && !d.private),
        privateOk: !cc || r.visibility === "public" || ((!!d.private || !!d["no-store"]) && !d.public && d["s-maxage"] === undefined),
      };
    } else if (scenario === "validator") {
      step = { hasValidator: validatorOf(await get(USERS[0])) !== undefined };
    } else if (scenario === "not-modified") {
      const v = validatorOf(await get(USERS[0]));
      const res = v === undefined ? null : await get(USERS[0], conditional(v));
      const is304 = !!res && res.status === 304;
      step = { is304, emptyBody: !is304 || empty(res) };
    } else if (scenario === "changed") {
      const v = validatorOf(await get(USERS[0]));
      const row = rows.get(keyOf(USERS[0]));
      row.name = `${row.name}-2`;
      row.updatedAt = new Date(T0 + 3600000).toISOString();
      const res = await get(USERS[0], conditional(v));
      step = { fresh: !!res && is2xx(res.status) };
    } else {
      const v = validatorOf(await get(USERS[0]));
      const res = await get(USERS[1], conditional(v));
      step = { isolated: !!res && is2xx(res.status) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const r of (params.resources || []).slice(0, MAX_RESOURCES)) for (const s of scenariosFor(r)) scenarios.push(await runScenario(r, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, directives };
