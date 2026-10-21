"use strict";

/**
 * Harness conductual de permisos del dispositivo (T29.2). Reloj y
 * plataforma de permisos inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su app real):
 *
 *   createPermissionsUnderTest({
 *     clock,        // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     platform,     // { status(kind) → "prompt"|"granted"|"denied"|"blocked",
 *                   //   request(kind) → Promise<"granted"|"denied"|"blocked"> }
 *     permissions,  // permisos del contrato
 *   }) → { launch(), useFeature(permissionId) → Promise,
 *          view() → { screen, rationale, fallback, settingsLink } }
 *
 *   screen: "app" | "blocked" | "error". `rationale`: la explicación de para
 *   qué se pide está visible. `fallback`: la alternativa sin permiso está
 *   disponible. `settingsLink`: hay un acceso a los ajustes del sistema.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { settle, deferred } = require("../shared/settle.js");
const { SCENARIOS, MAX_PERMISSIONS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-permissions-harness", version: "1.0.0" };
const SCREENS = ["app", "blocked", "error"];
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(perm, scenario, factory, permissions) {
  const id = `${scenario}@${perm.id}`;
  const clock = createVirtualClock(T0);
  const state = Object.fromEntries(permissions.map((p) => [p.kind, "prompt"]));
  if (scenario === "blocked") state[perm.kind] = "blocked";
  const answer = scenario === "granted" || scenario === "rationale" || scenario === "not-on-launch" ? "granted" : "denied";
  let requests = 0;
  let rationaleFirst = null;
  let sut;
  const viewOf = () => {
    try {
      const v = sut.view();
      return v && typeof v === "object" ? v : {};
    } catch (_) {
      return {};
    }
  };
  const platform = {
    status: (kind) => state[kind] || "prompt",
    request(kind) {
      if (kind === perm.kind) {
        requests += 1;
        if (rationaleFirst === null) rationaleFirst = viewOf().rationale === true;
      }
      if (state[kind] === "blocked") return deferred(clock, { afterMs: 10, value: "blocked" });
      const r = kind === perm.kind ? answer : "granted";
      state[kind] = r;
      return deferred(clock, { afterMs: 50, value: r });
    },
  };
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, platform, permissions: JSON.parse(JSON.stringify(permissions)) });
    if (!sut || ["launch", "useFeature", "view"].some((m) => typeof sut[m] !== "function")) throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const use = () => settle(() => sut.useFeature(perm.id), clock, 10000);
  const screenOf = () => {
    const s = viewOf().screen;
    return SCREENS.includes(s) ? s : "other";
  };
  let step;
  try {
    await settle(() => sut.launch(), clock, 10000);
    await advanceTo(clock, clock.now() + 1000);
    if (scenario === "not-on-launch") {
      step = { requests };
    } else if (scenario === "rationale") {
      await use();
      step = { rationaleFirst: rationaleFirst === true };
    } else if (scenario === "granted") {
      const r = await use();
      step = { requests, worked: !!r && r.ok && !(r.v && r.v.ok === false), screen: screenOf() };
    } else if (scenario === "denied") {
      const r = await use();
      const v = viewOf();
      step = { settled: !!r, requests, screen: screenOf(), fallback: v.fallback === true };
    } else if (scenario === "no-reprompt") {
      await use();
      const r = await use();
      step = { settled: !!r, requests, screen: screenOf() };
    } else {
      const r = await use();
      const v = viewOf();
      step = { settled: !!r, requests, settingsLink: v.settingsLink === true, screen: screenOf(), fallback: v.fallback === true };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const perms = (params.permissions || []).slice(0, MAX_PERMISSIONS);
  const scenarios = [];
  for (const p of perms) for (const s of SCENARIOS) scenarios.push(await runScenario(p, s, factory, perms));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
