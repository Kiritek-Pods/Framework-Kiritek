"use strict";

/**
 * Harness conductual de formularios (T19.2). Reloj virtual y envío
 * inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su formulario real):
 *
 *   createFormUnderTest({
 *     clock,   // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     form,    // { id, fields: [{ name, required, format, minLength?, maxLength? }] }
 *     submit,  // (values) → Promise — envío al backend (sintético; puede rechazar)
 *   }) → { fill(name, value), blur(name), submit(), view() → Snapshot }
 *
 *   Snapshot: { fields: [{ name, value, invalid, error, errorLinked }],
 *               focus: "field:<name>" | …,
 *               status: "idle"|"submitting"|"submitted"|"error",
 *               announced: boolean }  // error general anunciado (live region/alerta)
 *
 * `errorLinked`: el mensaje está asociado al campo (aria-describedby o
 * equivalente). La traza sólo lleva hechos derivados: nunca valores ni textos.
 */

const { createVirtualClock, advanceTo } = require("../shared/virtual-clock.js");
const { deferred } = require("../shared/settle.js");
const { messageState } = require("../shared/message-state.js");
const { scenariosFor, validValue, invalidValue, MAX_FORMS } = require("./scenarios.js");

const HARNESS = { name: "kiritek-form-harness", version: "1.0.0" };
const STATUSES = ["idle", "submitting", "submitted", "error"];
const SNAPSHOT_KEYS = ["fields", "focus", "status", "announced"];
const T0 = Date.UTC(2026, 5, 1);

/** Hechos derivados de un snapshot; nunca copia valores ni textos. */
function derive(snap, ctx) {
  const fields = snap && Array.isArray(snap.fields) ? snap.fields : [];
  const get = (name) => fields.find((f) => f && f.name === name) || {};
  const invalid = fields.filter((f) => f && f.invalid === true);
  const out = { submits: ctx.submits };
  if (ctx.expectInvalid) {
    const flagged = (names) => names.every((n) => get(n).invalid === true);
    if (ctx.requiredNames) out.requiredFlagged = flagged(ctx.requiredNames);
    if (ctx.constrainedNames) out.formatFlagged = flagged(ctx.constrainedNames);
    out.linked = invalid.length > 0 && invalid.every((f) => f.errorLinked === true);
    out.focusFirst = !!ctx.firstInvalid && snap && snap.focus === `field:${ctx.firstInvalid}`;
    const states = invalid.map((f) => messageState(f.error));
    out.message = !states.length ? "none" : states.find((s) => s !== "ok") || "ok";
  }
  if (ctx.allowedInvalid) out.noFalseErrors = invalid.every((f) => ctx.allowedInvalid.includes(f.name));
  if (ctx.filled) out.preserved = Object.entries(ctx.filled).every(([n, v]) => get(n).value === v);
  if (snap && typeof snap === "object") {
    out.status = STATUSES.includes(snap.status) ? snap.status : "other";
    out.announced = snap.announced === true;
    const dropped = Object.keys(snap).filter((k) => !SNAPSHOT_KEYS.includes(k)).length;
    if (dropped) out.droppedFields = dropped;
  } else out.status = "other";
  return out;
}

async function runScenario(form, scenario, factory) {
  const id = `${scenario}@${form.id}`;
  const clock = createVirtualClock(T0);
  const sent = [];
  let reject = scenario === "server-error";
  let delay = scenario === "double-submit" ? 1000 : 100;
  const submit = (values) => {
    sent.push(JSON.parse(JSON.stringify(values || {})));
    const fail = reject;
    return deferred(clock, { afterMs: delay, value: { ok: true }, error: fail ? Object.assign(new Error("synthetic"), { code: "SYNTHETIC" }) : null });
  };
  let sut;
  try {
    sut = factory({ clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }, form: JSON.parse(JSON.stringify(form)), submit });
    if (!sut || ["fill", "blur", "submit", "view"].some((m) => typeof sut[m] !== "function")) throw new Error("API incompleta");
  } catch (_) {
    return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] };
  }
  const safe = (fn) => {
    try {
      Promise.resolve(fn()).catch(() => {});
    } catch (_) {
      /* el formulario que lanza deja de responder: hecho observado */
    }
  };
  const view = () => {
    try {
      return sut.view();
    } catch (_) {
      return null;
    }
  };
  let t = 0;
  const wait = async (ms) => {
    t += ms;
    await advanceTo(clock, T0 + t);
  };
  const fillAll = (valueOf) => {
    const filled = {};
    for (const f of form.fields) {
      const v = valueOf(f);
      filled[f.name] = v;
      safe(() => sut.fill(f.name, v));
      safe(() => sut.blur(f.name));
    }
    return filled;
  };
  const required = form.fields.filter((f) => f.required).map((f) => f.name);
  const constrained = form.fields.filter((f) => invalidValue(f) !== null).map((f) => f.name);
  const steps = [];
  try {
    if (scenario === "required") {
      safe(() => sut.submit());
      await wait(500);
      steps.push(derive(view(), { submits: sent.length, expectInvalid: true, requiredNames: required, firstInvalid: required[0] }));
    } else if (scenario === "format") {
      fillAll((f) => (constrained.includes(f.name) ? invalidValue(f) : validValue(f)));
      safe(() => sut.submit());
      await wait(500);
      const first = form.fields.find((f) => constrained.includes(f.name)).name;
      steps.push(derive(view(), { submits: sent.length, expectInvalid: true, constrainedNames: constrained, firstInvalid: first, allowedInvalid: constrained }));
    } else if (scenario === "valid-submit") {
      const filled = fillAll(validValue);
      safe(() => sut.submit());
      await wait(500);
      const step = derive(view(), { submits: sent.length, allowedInvalid: [] });
      step.valuesSent = sent.length === 1 && Object.entries(filled).every(([n, v]) => sent[0][n] === v);
      steps.push(step);
    } else if (scenario === "double-submit") {
      fillAll(validValue);
      for (let i = 0; i < 3; i += 1) {
        safe(() => sut.submit());
        await wait(10);
      }
      await wait(2000);
      steps.push(derive(view(), { submits: sent.length }));
    } else if (scenario === "server-error") {
      const filled = fillAll(validValue);
      safe(() => sut.submit());
      await wait(500);
      steps.push(derive(view(), { submits: sent.length, filled }));
      reject = false;
      safe(() => sut.submit());
      await wait(500);
      const after = derive(view(), { submits: sent.length });
      steps.push({ submits: after.submits, resubmitted: sent.length === 2 && after.status === "submitted" });
    } else if (scenario === "error-clears") {
      safe(() => sut.submit());
      await wait(200);
      const target = form.fields.find((f) => f.required);
      safe(() => sut.fill(target.name, validValue(target)));
      safe(() => sut.blur(target.name));
      await wait(200);
      const snap = view();
      const f = snap && Array.isArray(snap.fields) ? snap.fields.find((x) => x && x.name === target.name) : null;
      steps.push({ submits: sent.length, cleared: !!f && f.invalid !== true });
    }
    delay = 100;
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  for (const form of (params.forms || []).slice(0, MAX_FORMS)) {
    for (const s of scenariosFor(form)) scenarios.push(await runScenario(form, s, factory));
  }
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, derive, messageState };
