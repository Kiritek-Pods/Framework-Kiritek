"use strict";

/**
 * Pruebas del validador remoto de claves Jira (Tarea 23).
 *
 * NINGUNA prueba hace red real: se inyecta un transporte mock que mapea cada
 * clave a un status sintético. Las credenciales usan placeholders sintéticos.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const jira = require("../../src/integrations/jira.js");

// Placeholder sintético: NO es un token real ni un patrón de canario conocido.
const SYNTH_CRED = "synthetic-jira-token-PLACEHOLDER";
const TENANT_A = "https://acme.atlassian.net";
const TENANT_B = "https://globex.atlassian.net";

function fixedClock(ms = 1700000000000) {
  let t = ms;
  const fn = () => t;
  fn.advance = (d) => {
    t += d;
  };
  return fn;
}

function seqIds() {
  let n = 0;
  return () => `ev-${(n += 1)}`;
}

/** Transporte mock: devuelve el status mapeado por clave (default 200/exists). */
function mockTransport(map = {}) {
  return async ({ key, credentials }) => {
    // El transporte recibe credentials opacas; no debe filtrarlas y aquí sólo
    // comprobamos presencia cuando el test lo necesita.
    const m = map[key];
    if (typeof m === "function") return m({ key, credentials });
    return m || { status: 200, exists: true };
  };
}

function cfg(extra = {}) {
  return {
    mode: extra.mode || "enforce",
    jira: {
      enabled: true,
      baseUrl: TENANT_A,
      keyPattern: "[A-Z][A-Z0-9]+-[0-9]+",
      cacheTtlSeconds: 300,
      rateLimitPerMinute: 60,
      timeoutMs: 5000,
      unavailable: "fail-closed",
      ...extra.jira,
    },
  };
}

function run(input, deps) {
  const clock = deps.clock || fixedClock();
  const idGenerator = deps.idGenerator || seqIds();
  return jira.verifyKeys(input, { ...deps, clock, idGenerator });
}

// --- 23.3 Mapeo de outcomes ---

test("200 existe/accesible → allow verificado", async () => {
  const r = await run(
    { keys: ["ABC-1", "ABC-2"], mode: "enforce", config: cfg(), env: {} },
    { transport: mockTransport() }
  );
  assert.equal(r.decision, "allow");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.VERIFIED);
  assert.equal(r.meta.verified, true);
});

test("404 no existe → deny en enforce (negativa definitiva)", async () => {
  const r = await run(
    { keys: ["ABC-9"], mode: "enforce", config: cfg(), env: {} },
    { transport: mockTransport({ "ABC-9": { status: 404 } }) }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.NOT_FOUND);
  assert.equal(r.meta.verified, false);
});

test("404 no existe → warn en warning (degrada, sigue negativa)", async () => {
  const r = await run(
    { keys: ["ABC-9"], mode: "warning", config: cfg({ mode: "warning" }), env: {} },
    { transport: mockTransport({ "ABC-9": { status: 404 } }) }
  );
  assert.equal(r.decision, "warn");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.NOT_FOUND);
});

test("política inválida (policyOk=false) → deny invalid", async () => {
  const r = await run(
    { keys: ["ABC-3"], mode: "enforce", config: cfg(), env: {} },
    { transport: mockTransport({ "ABC-3": { status: 200, exists: true, policyOk: false } }) }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.INVALID);
});

// --- 23.3/23.4 Indisponibilidad y fallbacks ---

test("401 con fail-closed enforce → deny, nunca verificado", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { unavailable: "fail-closed" } }), env: {} },
    { transport: mockTransport({ "ABC-1": { status: 401 } }) }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.NOT_VERIFIED_REMOTELY);
  assert.equal(r.meta.verified, false);
  assert.equal(r.meta.fallback, "fail-closed");
});

test("401 con warn fallback → warn, no_verificado_remotamente", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { unavailable: "warn" } }), env: {} },
    { transport: mockTransport({ "ABC-1": { status: 401 } }) }
  );
  assert.equal(r.decision, "warn");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.NOT_VERIFIED_REMOTELY);
  assert.equal(r.meta.verified, false);
});

test("429 rate-limited remoto → indisponibilidad", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "warning", config: cfg({ mode: "warning", jira: { unavailable: "fail-closed" } }), env: {} },
    { transport: mockTransport({ "ABC-1": { status: 429 } }) }
  );
  // warning + fail-closed → warn (no deny), pero NUNCA verificado.
  assert.equal(r.decision, "warn");
  assert.equal(r.meta.verified, false);
  assert.equal(r.meta.outcomes["ABC-1"], jira.OUTCOME.RATE_LIMITED);
});

test("timeout → indisponibilidad (fail-closed enforce → deny)", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { unavailable: "fail-closed" } }), env: {} },
    { transport: mockTransport({ "ABC-1": { status: "timeout" } }) }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.meta.outcomes["ABC-1"], jira.OUTCOME.TIMEOUT);
  assert.equal(r.meta.verified, false);
});

test("negativa definitiva domina sobre indisponibilidad", async () => {
  const r = await run(
    { keys: ["ABC-1", "ABC-404"], mode: "enforce", config: cfg(), env: {} },
    { transport: mockTransport({ "ABC-1": { status: 401 }, "ABC-404": { status: 404 } }) }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.NOT_FOUND);
});

// --- 23.4 Credenciales obligatorias ausentes ---

test("credenciales obligatorias ausentes → error en enforce, sin imprimir valor", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { requireCredentials: true } }), env: {} },
    { transport: mockTransport() }
  );
  assert.equal(r.decision, "error");
  assert.equal(r.meta.credentials, "missing");
  assert.equal(r.meta.verified, false);
  // El resultado explica cómo configurarlas pero jamás contiene un valor.
  assert.equal(JSON.stringify(r).includes(SYNTH_CRED), false);
});

test("credenciales presentes se pasan al transporte sin filtrarse al resultado", async () => {
  let sawPresent = false;
  const transport = async ({ credentials }) => {
    sawPresent = credentials.present === true;
    return { status: 200, exists: true };
  };
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { requireCredentials: true } }), env: { KIRITEK_JIRA_TOKEN: SYNTH_CRED } },
    { transport }
  );
  assert.equal(sawPresent, true);
  assert.equal(r.decision, "allow");
  assert.equal(JSON.stringify(r).includes(SYNTH_CRED), false);
});

test("resolveCredentials nunca serializa el valor", () => {
  const creds = jira.resolveCredentials({ KIRITEK_JIRA_TOKEN: SYNTH_CRED, KIRITEK_JIRA_EMAIL: "a@b.com" });
  assert.equal(creds.present, true);
  assert.equal(JSON.stringify(creds).includes(SYNTH_CRED), false);
  assert.equal(JSON.stringify(creds).includes("a@b.com"), false);
});

// --- 23.1 Deduplicación y rate limiting ---

test("deduplica claves repetidas: una sola consulta por clave", async () => {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { status: 200, exists: true };
  };
  const r = await run(
    { keys: ["ABC-1", "ABC-1", "ABC-2", "ABC-1"], mode: "enforce", config: cfg(), env: {} },
    { transport }
  );
  assert.equal(r.decision, "allow");
  assert.equal(calls, 2); // sólo ABC-1 y ABC-2
  assert.deepEqual(r.meta.keys, ["ABC-1", "ABC-2"]);
});

test("rate limit local: claves por encima del límite no se consultan y no se verifican", async () => {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { status: 200, exists: true };
  };
  const r = await run(
    { keys: ["A-1", "A-2", "A-3"], mode: "warning", config: cfg({ mode: "warning", jira: { rateLimitPerMinute: 2, unavailable: "warn" } }), env: {} },
    { transport }
  );
  assert.equal(calls, 2);
  // La tercera clave quedó rate-limited localmente → indisponibilidad, no verificado.
  assert.equal(r.meta.outcomes["A-3"], jira.OUTCOME.RATE_LIMITED);
  assert.equal(r.meta.verified, false);
});

// --- 23.2 Caché por tenant+clave con TTL ---

test("cachea veredictos estables y no reconsulta dentro del TTL", async () => {
  const clock = fixedClock();
  const cache = new jira.JiraCache({ clock });
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { status: 200, exists: true };
  };
  const c = cfg({ jira: { cacheTtlSeconds: 10 } });
  await run({ keys: ["ABC-1"], mode: "enforce", config: c, env: {} }, { transport, cache, clock });
  await run({ keys: ["ABC-1"], mode: "enforce", config: c, env: {} }, { transport, cache, clock });
  assert.equal(calls, 1);
  clock.advance(11000);
  await run({ keys: ["ABC-1"], mode: "enforce", config: c, env: {} }, { transport, cache, clock });
  assert.equal(calls, 2);
});

test("no reutiliza caché entre tenants distintos", async () => {
  const clock = fixedClock();
  const cache = new jira.JiraCache({ clock });
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { status: 200, exists: true };
  };
  await run({ keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { baseUrl: TENANT_A } }), env: {} }, { transport, cache, clock });
  await run({ keys: ["ABC-1"], mode: "enforce", config: cfg({ jira: { baseUrl: TENANT_B } }), env: {} }, { transport, cache, clock });
  assert.equal(calls, 2); // distinto tenant → nueva consulta
});

test("no cachea indisponibilidad transitoria", async () => {
  const clock = fixedClock();
  const cache = new jira.JiraCache({ clock });
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { status: 503 };
  };
  await run({ keys: ["ABC-1"], mode: "warning", config: cfg({ mode: "warning", jira: { unavailable: "warn" } }), env: {} }, { transport, cache, clock });
  await run({ keys: ["ABC-1"], mode: "warning", config: cfg({ mode: "warning", jira: { unavailable: "warn" } }), env: {} }, { transport, cache, clock });
  assert.equal(calls, 2); // el error no se cachea
  assert.equal(cache.size, 0);
});

// --- Jira deshabilitado / sin tenant / sin claves ---

test("jira deshabilitado → allow not_configured, no es afirmación remota", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: { mode: "enforce", jira: { enabled: false } }, env: {} },
    { transport: mockTransport() }
  );
  assert.equal(r.decision, "allow");
  assert.equal(r.meta.remoteState, jira.REMOTE_STATE.NOT_CONFIGURED);
  assert.equal(r.meta.verified, false);
});

test("habilitado sin baseUrl → indisponibilidad (fail-closed enforce → deny)", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: { mode: "enforce", jira: { enabled: true, unavailable: "fail-closed" } }, env: {} },
    { transport: mockTransport() }
  );
  assert.equal(r.decision, "deny");
  assert.equal(r.meta.verified, false);
});

test("sin claves nuevas → allow (nada que verificar)", async () => {
  const r = await run(
    { keys: [], mode: "enforce", config: cfg(), env: {} },
    { transport: mockTransport() }
  );
  assert.equal(r.decision, "allow");
});

// --- Evidencia mínima ---

test("evidencia mínima registra comando, versión, alcance, exit code y decisión", async () => {
  const r = await run(
    { keys: ["ABC-1"], mode: "enforce", config: cfg(), env: {}, scope: "ci:pull_request" },
    { transport: mockTransport() }
  );
  assert.ok(r.evidence);
  assert.equal(r.evidence.decision, "allow");
  assert.equal(r.evidence.scope, "ci:pull_request");
  assert.equal(typeof r.evidence.exitCode, "number");
  assert.ok(r.evidence.command.includes("validate push"));
});

// --- normalizeOutcome unitario ---

test("normalizeOutcome mapea status crudos", () => {
  assert.equal(jira.normalizeOutcome({ status: 200, exists: true }), jira.OUTCOME.ACCESSIBLE);
  assert.equal(jira.normalizeOutcome({ status: 200, exists: false }), jira.OUTCOME.DOES_NOT_EXIST);
  assert.equal(jira.normalizeOutcome({ status: 404 }), jira.OUTCOME.DOES_NOT_EXIST);
  assert.equal(jira.normalizeOutcome({ status: 401 }), jira.OUTCOME.UNAUTHORIZED);
  assert.equal(jira.normalizeOutcome({ status: 403 }), jira.OUTCOME.UNAUTHORIZED);
  assert.equal(jira.normalizeOutcome({ status: 429 }), jira.OUTCOME.RATE_LIMITED);
  assert.equal(jira.normalizeOutcome({ status: "timeout" }), jira.OUTCOME.TIMEOUT);
  assert.equal(jira.normalizeOutcome({ status: 500 }), jira.OUTCOME.ERROR);
});
