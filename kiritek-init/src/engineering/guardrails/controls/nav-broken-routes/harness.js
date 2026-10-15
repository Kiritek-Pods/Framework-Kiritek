"use strict";

/**
 * Harness conductual de rutas y enlaces (T30.2). Reloj y sesión inyectados;
 * framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su router real):
 *
 *   createRouterUnderTest({
 *     clock,     // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     session,   // { authenticated() → boolean }
 *     routes,    // rutas del contrato
 *   }) → { navigate(url) → Promise, login() → Promise,
 *          view() → { status, route, url, exitLink } }
 *
 *   status: "ok" | "not-found" | "login" | "error". `route`: patrón de ruta
 *   que se muestra (p. ej. "/orders/:id"). `url`: URL actual. `exitLink`: la
 *   página ofrece una salida (inicio o volver).
 *
 * La traza sólo lleva estados y booleanos: nunca URLs.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { settle } = require("../shared/settle.js");
const { scenarioIds, concrete, publicRoute, authRoute, UNKNOWN, MALFORMED } = require("./scenarios.js");

const HARNESS = { name: "kiritek-routes-harness", version: "1.0.0" };
const STATES = ["ok", "not-found", "login", "error"];
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(id, factory, facts) {
  const clock = createVirtualClock(T0);
  let authenticated = id !== "deep-auth";
  const session = { authenticated: () => authenticated };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, session, routes: JSON.parse(JSON.stringify(facts.routes)) });
    if (!sut || typeof sut.navigate !== "function" || typeof sut.view !== "function") throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const view = () => {
    try {
      const v = sut.view();
      return v && typeof v === "object" ? v : null;
    } catch (_) {
      return null;
    }
  };
  const stateOf = (v) => (!v ? "blank" : STATES.includes(v.status) ? v.status : "other");
  const go = async (url) => {
    const r = await settle(() => sut.navigate(url), clock, 10000);
    return { threw: !r || !r.ok, v: view() };
  };
  const steps = [];
  try {
    if (id === "known") {
      const route = publicRoute(facts);
      const { threw, v } = await go(concrete(route.path));
      steps.push({ threw, state: stateOf(v), routeOk: !!v && v.route === route.path });
    } else if (id === "unknown") {
      const { threw, v } = await go(UNKNOWN);
      steps.push({ threw, state: stateOf(v), exitLink: !!v && v.exitLink === true });
    } else if (id === "malformed") {
      const { threw, v } = await go(MALFORMED);
      steps.push({ threw, state: stateOf(v) });
    } else {
      const route = authRoute(facts);
      const target = `${concrete(route.path)}?tab=kitems`;
      const { v } = await go(target);
      steps.push({ state: stateOf(v) });
      authenticated = true;
      if (typeof sut.login === "function") await settle(() => sut.login(), clock, 10000);
      const after = view();
      const url = after && typeof after.url === "string" ? after.url : "";
      steps.push({ returned: !!after && after.route === route.path && stateOf(after) === "ok", queryKept: url.includes("tab=kitems") });
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const id of scenarioIds(params)) scenarios.push(await runScenario(id, factory, params));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
