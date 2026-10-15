"use strict";

/**
 * Harness conductual de subidas de archivos (T23.2). Reloj y transporte
 * inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su componente de subida):
 *
 *   createUploadUnderTest({
 *     clock,      // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     transport,  // { upload({ file, onProgress(pct) }) → { done: Promise, abort() } }
 *     upload,     // { id, maxBytes, accept, cancel, retry } del contrato
 *   }) → { select(file), start(), cancel(), retry(), view() → { status, progress, error } }
 *
 *   file: { name, type, size } sintético (sin contenido).
 *   status: "idle"|"selected"|"rejected"|"uploading"|"done"|"error"|"cancelled".
 *
 * La traza sólo lleva estado, conteos y la clase del mensaje.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { messageState } = require("../shared/message-state.js");
const { scenariosFor, acceptedType, WRONG_TYPE, MAX_UPLOADS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-upload-harness", version: "1.0.0" };
const STATES = ["idle", "selected", "rejected", "uploading", "done", "error", "cancelled"];
const T0 = Date.UTC(2026, 5, 1);

async function runScenario(u, scenario, factory) {
  const id = `${scenario}@${u.id}`;
  const clock = createVirtualClock(T0);
  let uploads = 0;
  let aborted = false;
  let failNext = scenario === "network-error";
  const transport = {
    upload({ onProgress } = {}) {
      uploads += 1;
      const fail = failNext;
      failNext = false;
      const timers = [];
      let settle;
      const done = new Promise((resolve, reject) => (settle = { resolve, reject }));
      done.catch(() => {});
      const at = (ms, fn) => timers.push(clock.setTimeout(fn, ms));
      [25, 50, 75].forEach((pct, i) => at(100 * (i + 1), () => typeof onProgress === "function" && onProgress(pct)));
      at(fail ? 200 : 400, () => (fail ? settle.reject(Object.assign(new Error("synthetic"), { code: "ECONNRESET" })) : settle.resolve({ ok: true })));
      return {
        done,
        abort() {
          aborted = true;
          timers.forEach((t) => clock.clearTimeout(t));
          settle.reject(Object.assign(new Error("aborted"), { code: "ABORTED" }));
        },
      };
    },
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, transport, upload: JSON.parse(JSON.stringify(u)) });
    if (!sut || ["select", "start", "view"].some((m) => typeof sut[m] !== "function")) throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const fire = (fn) => {
    try {
      Promise.resolve(fn()).catch(() => {});
    } catch (_) {
      /* el componente que lanza no avanza: hecho observado */
    }
  };
  const view = () => {
    try {
      const v = sut.view();
      return v && typeof v === "object" ? v : {};
    } catch (_) {
      return {};
    }
  };
  const state = (v) => (STATES.includes(v.status) ? v.status : "other");
  let t = 0;
  const wait = (ms) => advanceTo(clock, T0 + (t += ms));
  const file = scenario === "too-large" ? { name: "archivo-sintetico.bin", type: acceptedType(u), size: u.maxBytes + 1 } : scenario === "wrong-type" ? { name: "archivo-sintetico.exe", type: WRONG_TYPE, size: Math.min(1024, u.maxBytes) } : { name: "archivo-sintetico.bin", type: acceptedType(u), size: Math.min(1024, u.maxBytes) };
  const steps = [];
  try {
    fire(() => sut.select(file));
    fire(() => sut.start());
    if (scenario === "accept") {
      await wait(200);
      const mid = view();
      const progressSeen = typeof mid.progress === "number" && mid.progress > 0 && mid.progress < 100;
      await wait(1000);
      steps.push({ state: state(view()), uploads, progressSeen });
    } else if (scenario === "too-large" || scenario === "wrong-type") {
      await wait(100);
      const v = view();
      steps.push({ state: state(v), uploads, message: messageState(v.error) });
    } else if (scenario === "cancel") {
      await wait(150);
      fire(() => (typeof sut.cancel === "function" ? sut.cancel() : undefined));
      await wait(1000);
      steps.push({ state: state(view()), uploads, aborted });
    } else if (scenario === "network-error") {
      await wait(500);
      steps.push({ state: state(view()), uploads });
      if (u.retry === "required") {
        fire(() => (typeof sut.retry === "function" ? sut.retry() : undefined));
        await wait(1000);
        steps.push({ uploads, retried: uploads === 2 && state(view()) === "done" });
      }
    } else if (scenario === "double-start") {
      fire(() => sut.start());
      await wait(1000);
      steps.push({ state: state(view()), uploads });
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const u of (params.uploads || []).slice(0, MAX_UPLOADS)) for (const s of scenariosFor(u)) scenarios.push(await runScenario(u, s, factory));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario };
