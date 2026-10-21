"use strict";

/**
 * Harness conductual de sesión expirada (T22.2). Reloj, transporte y
 * proveedor de tokens inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su cliente/app real):
 *
 *   createSessionUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,  // { send({ op, token }) → Promise<{ status }> } — 401 si el token venció
 *     auth,       // { token() → string, refresh() → Promise<string> } (refresh puede rechazar)
 *     session,    // { refresh, preserveWork } del contrato
 *   }) → { request(op) → Promise, setDraft(text), view() → { screen, draft } }
 *
 *   screen: "app" | "login" | "error". `draft`: el trabajo en curso que la app conserva.
 *
 * La traza sólo lleva conteos y booleanos: nunca tokens ni el borrador.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { scenariosFor } = require("./scenarios.js");

const HARNESS = { name: "kiritek-session-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const DRAFT = "borrador sintético 7f3a";
const SCREENS = ["app", "login", "error"];

async function runScenario(id, factory, session) {
  const clock = createVirtualClock(T0);
  const valid = new Set(id === "valid" ? ["t0"] : []);
  let current = "t0";
  let sends = 0;
  let refreshes = 0;
  const transport = {
    send(req) {
      sends += 1;
      return deferred(clock, { afterMs: 20, value: { status: valid.has(req && req.token) ? 200 : 401 } });
    },
  };
  const auth = {
    token: () => current,
    refresh() {
      refreshes += 1;
      if (id === "refresh-fails") return deferred(clock, { afterMs: 50, error: Object.assign(new Error("synthetic"), { code: "SYNTHETIC" }) });
      const next = `t${refreshes}`;
      if (id !== "repeated-401") valid.add(next);
      return deferred(clock, { afterMs: 100, value: next }).then((t) => (current = t));
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, auth, session: { ...session } });
    if (!sut || typeof sut.request !== "function" || typeof sut.view !== "function") throw new Error("sin request()/view()");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  try {
    if (typeof sut.setDraft === "function") sut.setDraft(DRAFT);
  } catch (_) {
    /* sin borrador: draftPreserved queda false */
  }
  let states;
  try {
    const n = id === "concurrent" ? 3 : 1;
    states = await Promise.all(Array.from({ length: n }, (_, i) => settle(() => sut.request(`op-${i + 1}`), clock, 30000)));
    await advanceTo(clock, clock.now() + 1000);
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  let view = null;
  try {
    view = sut.view();
  } catch (_) {
    view = null;
  }
  const step = {
    ok: states.every((s) => s && s.ok),
    settled: states.every(Boolean),
    sends,
    refreshes,
    screen: view && SCREENS.includes(view.screen) ? view.screen : "other",
    draftPreserved: !!view && view.draft === DRAFT,
  };
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const id of scenariosFor(params.session)) scenarios.push(await runScenario(id, factory, params.session));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, DRAFT, runSuite, runScenario };
