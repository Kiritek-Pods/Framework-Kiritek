"use strict";

/**
 * Harness conductual de anuncios web (T12.4–T12.6). Reloj virtual, storage,
 * viewer, rollout y mensajes inyectados; framework-neutral.
 *
 * Interfaz del adapter (glue del equipo con su componente real):
 *
 *   createAnnouncementUnderTest({
 *     clock,              // { now(), setTimeout(fn, ms), clearTimeout(id) }
 *     storage,            // { getItem(k), setItem(k, v), removeItem(k) } — puede lanzar (no disponible)
 *     viewer,             // { userId, accountId, role } sintéticos
 *     locale, messages,   // mensajes sintéticos por locale (clave → texto)
 *     rollout,            // { state() → draft|active|paused|retired }
 *     prefersReducedMotion,
 *     announcement,       // configuración sintética (ver scenarios.announcementFor)
 *   }) → { render(): Promise<Snapshot>, press(key: "Tab"|"Escape"): Promise<Snapshot> }
 *
 *   Snapshot: { moduleAvailable, focus: "announcement"|"control:<id>"|"origin"|…,
 *               announcement: null | { role, modal?, name, title, body,
 *                 controls: [{ id, name, keyboard }], colors: { text, background },
 *                 motion: { animated, durationMs } } }
 *
 * Cada `createAnnouncementUnderTest` es una sesión (carga de página); el
 * storage persiste entre sesiones salvo que el escenario lo borre.
 *
 * La traza sólo lleva HECHOS DERIVADOS (booleanos/enums/ratio): nunca texto
 * renderizado ni campos del snapshot; los campos desconocidos sólo se cuentan.
 */

const { createVirtualClock, flush, advanceTo } = require("../shared/virtual-clock.js");
const { buildScenarios, announcementFor, REFS, DAY } = require("./scenarios.js");

const ROLES = ["dialog", "alertdialog", "region", "status"];
const SNAPSHOT_KEYS = ["moduleAvailable", "focus", "announcement"];
const ANNOUNCEMENT_KEYS = ["role", "modal", "name", "title", "body", "controls", "colors", "motion"];
const SETTLE_LIMIT_MS = 30000;

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG (1–21) o null si los colores no son válidos. */
function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

const strip = (s) => String(s).replace(/<[^>]*>?/g, "").replace(/\s+/g, " ").trim();
const MARKUP_RE = /[<>]|&lt;|&gt;|&amp;/;

function textState(a, messages, locale, defaultLocale) {
  const title = typeof a.title === "string" ? a.title : "";
  const body = typeof a.body === "string" ? a.body : "";
  const all = `${title}\n${body}`;
  if (MARKUP_RE.test(all)) return "broken-markup";
  if (REFS.some((r) => all.includes(r))) return "internal-key";
  if (!title.trim() || !body.trim()) return "empty";
  const same = (loc) => {
    const m = messages[loc] || {};
    return m[REFS[0]] !== undefined && m[REFS[1]] !== undefined && title.trim() === strip(m[REFS[0]]) && body.trim() === strip(m[REFS[1]]);
  };
  if (same(locale)) return "expected-locale";
  if (same(defaultLocale)) return "default-locale";
  return "fallback-text";
}

const unknownKeys = (obj, keys) => (obj && typeof obj === "object" ? Object.keys(obj).filter((k) => !keys.includes(k)).length : 0);

/** Deriva hechos de un snapshot; nunca copia texto. */
function derive(snap, ctx) {
  if (!snap || typeof snap !== "object") return { visible: false, moduleAvailable: false };
  const a = snap.announcement && typeof snap.announcement === "object" ? snap.announcement : null;
  const out = { visible: !!a, moduleAvailable: snap.moduleAvailable === true };
  let dropped = unknownKeys(snap, SNAPSHOT_KEYS);
  if (a) {
    dropped += unknownKeys(a, ANNOUNCEMENT_KEYS);
    const controls = Array.isArray(a.controls) ? a.controls : [];
    const refLike = (s) => typeof s !== "string" || !s.trim() || REFS.includes(s.trim()) || MARKUP_RE.test(s);
    out.roleValid = ROLES.includes(a.role);
    out.nameOk = !refLike(a.name);
    out.controlsNamed = controls.length > 0 && controls.every((c) => c && !refLike(c.name));
    out.stateConsistent = ["dialog", "alertdialog"].includes(a.role) ? typeof a.modal === "boolean" : a.modal !== true;
    out.keyboardReachable = controls.length > 0 && controls.every((c) => c && c.keyboard === true);
    out.closeControl = controls.some((c) => c && c.id === "close");
    out.focusOnOpen = snap.focus === "announcement" || (typeof snap.focus === "string" && snap.focus.startsWith("control:"));
    const ratio = contrastRatio(a.colors && a.colors.text, a.colors && a.colors.background);
    if (ratio !== null) out.contrastRatio = ratio;
    out.contrastOk = ratio !== null && ratio >= ctx.contrastMin;
    const motion = a.motion || {};
    out.reducedMotionOk = !ctx.reducedMotion || !(motion.animated === true && Number(motion.durationMs) > 0);
    out.textState = textState(a, ctx.messages, ctx.locale, ctx.defaultLocale);
  }
  if (dropped) out.droppedFields = dropped;
  return out;
}

async function settle(fn, clock) {
  let state = null;
  Promise.resolve()
    .then(fn)
    .then((v) => (state = { ok: true, v }), () => (state = { ok: false }));
  const start = clock.now();
  for (let guard = 0; guard < 100000 && !state; guard += 1) {
    await flush();
    if (state) break;
    const due = clock.nextDue(start + SETTLE_LIMIT_MS);
    if (!due) break;
    clock.take(due);
    due.fn();
  }
  await flush();
  return state;
}

function createStorage(mode) {
  const map = new Map();
  const guard = () => {
    if (mode === "throws") throw Object.assign(new Error("storage no disponible"), { name: "SecurityError" });
  };
  return {
    api: {
      getItem: (k) => (guard(), map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => (guard(), void map.set(String(k), String(v))),
      removeItem: (k) => (guard(), void map.delete(String(k))),
    },
    clear: () => map.clear(),
  };
}

class Timeout extends Error {}

async function runScenario(id, plan, factory, params) {
  const clock = createVirtualClock(plan.start);
  const storage = createStorage(plan.storage);
  let rolloutState = plan.rollout;
  const announcement = announcementFor(params);
  const ctx = { contrastMin: params.contrastMin, reducedMotion: plan.reducedMotion, messages: plan.messages, locale: plan.locale, defaultLocale: announcement.content.defaultLocale };
  let sut = null;

  const open = (viewer) => {
    sut = factory({
      clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
      storage: storage.api,
      viewer: { ...viewer },
      locale: plan.locale,
      messages: JSON.parse(JSON.stringify(plan.messages)),
      rollout: { state: () => rolloutState },
      prefersReducedMotion: plan.reducedMotion,
      announcement: JSON.parse(JSON.stringify(announcement)),
    });
    if (!sut || typeof sut.render !== "function" || typeof sut.press !== "function") throw new Error("sin render()/press()");
  };
  // Un render que lanza deja el módulo inutilizable: hecho determinista.
  const call = async (fn) => {
    const state = await settle(fn, clock);
    if (!state) throw new Timeout();
    return state.ok ? state.v : { moduleAvailable: false, announcement: null };
  };

  const steps = [];
  try {
    for (const step of plan.ops) {
      if (step.op === "clear") storage.clear();
      else if (step.op === "advanceDays") await advanceTo(clock, clock.now() + step.days * DAY);
      else if (step.op === "rollout") rolloutState = step.state;
      else {
        if (step.op !== "render") {
          try {
            open(step.viewer || plan.viewer);
          } catch (_) {
            // Con storage no disponible, fallar al montar es el defecto observado.
            if (plan.storage !== "throws") return { id, status: "error", limitation: "ADAPTER_INIT_FAILED", steps };
            steps.push({ visible: false, moduleAvailable: false });
            continue;
          }
        }
        const snap = await call(() => sut.render());
        const facts = derive(snap, ctx);
        if (step.op === "keyboard" && facts.visible) {
          const controls = snap.announcement.controls || [];
          const seen = new Set();
          for (let i = 0; i < controls.length + 1; i += 1) {
            const s = await call(() => sut.press("Tab"));
            if (s && typeof s.focus === "string") seen.add(s.focus);
          }
          facts.tabVisitsAll = controls.length > 0 && controls.every((c) => c && seen.has(`control:${c.id}`));
        }
        if (step.op === "close" && facts.visible) {
          const after = await call(() => sut.press("Escape"));
          facts.escapeCloses = !!after && after.moduleAvailable === true && !after.announcement;
          facts.focusReturns = facts.escapeCloses && after.focus === "origin";
        }
        steps.push(facts);
      }
    }
  } catch (err) {
    if (err instanceof Timeout) return { id, status: "timeout", limitation: "RENDER_TIMEOUT", steps };
    return { id, status: "error", limitation: "HARNESS_ERROR", steps };
  }
  return { id, status: "ok", steps };
}

async function runSuite(factory, params) {
  const scenarios = [];
  const plans = buildScenarios(params);
  for (const [id, plan] of Object.entries(plans)) scenarios.push(await runScenario(id, plan, factory, params));
  // Si el adapter no monta ni con storage sano, su fallo con storage no
  // disponible no es atribuible al storage.
  if (scenarios.some((s) => s.limitation === "ADAPTER_INIT_FAILED")) {
    for (const s of scenarios) {
      if (plans[s.id].storage === "throws" && s.status === "ok") Object.assign(s, { status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] });
    }
  }
  return { schemaVersion: 1, harness: { name: "kiritek-announcement-harness", version: "1.0.0" }, scenarios };
}

module.exports = { runSuite, runScenario, derive, contrastRatio };
