"use strict";

/**
 * Escenarios conductuales de `web.module-announcement` (T12.4–T12.6).
 * Todo es sintético: viewers, mensajes, locales e ids los fabrica el harness;
 * las POLÍTICAS (alcance/periodo show-once, storage ausente, contenido
 * faltante, animación, contraste) salen del launch manifest del equipo.
 */

const DAY = 86400000;
const T0 = Date.UTC(2026, 5, 1);

const SHOW_ONCE = ["first-visit", "repeat-visit", "storage-cleared", "storage-unavailable", "period-elapsed", "other-viewer"];
const ROLLOUT = ["rollout-paused", "rollout-retired"];
const TARGETING = ["outside-window", "audience-excluded"];
const A11Y = ["keyboard", "focus", "name-role-state", "close", "contrast", "reduced-motion"];
const CONTENT = ["locale-fallback", "missing-content", "broken-markup"];
const REQUIRED_SCENARIOS = [...SHOW_ONCE, ...ROLLOUT, ...TARGETING, ...A11Y, ...CONTENT];

const MESSAGES = {
  en: { "announce.title": "New reports module", "announce.body": "Explore the new reports module." },
  es: { "announce.title": "Nuevo módulo de reportes", "announce.body": "Explora el nuevo módulo de reportes." },
};
const REFS = ["announce.title", "announce.body"];
const VIEWER_A = { userId: "viewer-a", accountId: "account-1", role: "admin" };
const VIEWER_B = { userId: "viewer-b", accountId: "account-2", role: "admin" };

/** Configuración sintética del anuncio que recibe el adapter. */
function announcementFor(params) {
  return {
    id: "ann-under-test",
    version: 1,
    window: { start: T0 - DAY, end: T0 + (params.periodDays * 3 + 30) * DAY },
    audience: { criteria: [{ attribute: "role", operator: "in", values: ["admin"] }] },
    showOnce: { key: "ann-under-test-v1", audienceScope: params.audienceScope, periodDays: params.periodDays, storageUnavailable: params.storageUnavailable },
    content: { titleRef: REFS[0], bodyRef: REFS[1], locales: ["en", "es"], defaultLocale: "en", missingContent: params.missingContent },
    animated: params.animated,
  };
}

/**
 * Planes: `ops` es una secuencia de visit (sesión nueva), render (misma
 * sesión), clear, advanceDays, rollout, keyboard, close. Cada visit/render/
 * keyboard/close produce un paso observado.
 */
function buildScenarios(params) {
  const base = { start: T0, locale: "es", viewer: VIEWER_A, storage: "ok", messages: MESSAGES, reducedMotion: false, rollout: "active" };
  const plan = (over) => ({ ...base, ...over });
  return {
    "first-visit": plan({ ops: [{ op: "visit" }] }),
    "repeat-visit": plan({ ops: [{ op: "visit" }, { op: "visit" }] }),
    "storage-cleared": plan({ ops: [{ op: "visit" }, { op: "clear" }, { op: "visit" }, { op: "visit" }] }),
    "storage-unavailable": plan({ storage: "throws", ops: [{ op: "visit" }, { op: "render" }, { op: "visit" }] }),
    "period-elapsed": plan({ ops: [{ op: "visit" }, { op: "advanceDays", days: 1 }, { op: "visit" }, { op: "advanceDays", days: params.periodDays }, { op: "visit" }] }),
    "other-viewer": plan({ ops: [{ op: "visit" }, { op: "visit", viewer: VIEWER_B }] }),
    "rollout-paused": plan({ rollout: "paused", ops: [{ op: "visit" }, { op: "rollout", state: "active" }, { op: "visit" }] }),
    "rollout-retired": plan({ rollout: "retired", ops: [{ op: "visit" }] }),
    "outside-window": plan({ start: T0 - 3 * DAY, ops: [{ op: "visit" }, { op: "advanceDays", days: params.periodDays * 3 + 40 }, { op: "visit" }] }),
    "audience-excluded": plan({ viewer: { ...VIEWER_A, role: "member" }, ops: [{ op: "visit" }] }),
    keyboard: plan({ ops: [{ op: "keyboard" }] }),
    focus: plan({ ops: [{ op: "visit" }] }),
    "name-role-state": plan({ ops: [{ op: "visit" }] }),
    close: plan({ ops: [{ op: "close" }] }),
    contrast: plan({ ops: [{ op: "visit" }] }),
    "reduced-motion": plan({ reducedMotion: true, ops: [{ op: "visit" }] }),
    "locale-fallback": plan({ locale: "fr", ops: [{ op: "visit" }] }),
    "missing-content": plan({ messages: { en: {}, es: {} }, ops: [{ op: "visit" }] }),
    "broken-markup": plan({ messages: { ...MESSAGES, es: { ...MESSAGES.es, "announce.body": "Explora el <b>nuevo módulo de reportes" } }, ops: [{ op: "visit" }] }),
  };
}

/** Pasos esperados por escenario según la política declarada. */
function expectationsFor(id, params) {
  const on = { visible: true, moduleAvailable: true };
  const off = { visible: false, moduleAvailable: true };
  switch (id) {
    case "first-visit":
      return [on];
    case "repeat-visit":
      return [on, off];
    case "storage-cleared":
      return [on, on, off];
    case "storage-unavailable":
      return { suppress: [off, off, off], "once-per-session": [on, off, on], show: [on, on, on] }[params.storageUnavailable];
    case "period-elapsed":
      return [on, off, on];
    case "other-viewer":
      return [on, params.audienceScope === "device" ? off : on];
    case "rollout-paused":
      return [off, on];
    case "rollout-retired":
    case "audience-excluded":
      return [off];
    case "outside-window":
      return [off, off];
    case "keyboard":
      return [{ ...on, keyboardReachable: true, tabVisitsAll: true }];
    case "focus":
      return [{ ...on, focusOnOpen: true }];
    case "name-role-state":
      return [{ ...on, roleValid: true, nameOk: true, controlsNamed: true, stateConsistent: true }];
    case "close":
      return [{ ...on, closeControl: true, escapeCloses: true, focusReturns: true }];
    case "contrast":
      return [{ ...on, contrastOk: true }];
    case "reduced-motion":
      return [{ ...on, reducedMotionOk: true }];
    case "locale-fallback":
      return [{ ...on, textState: "default-locale" }];
    case "missing-content":
      return params.missingContent === "hide" ? [off] : [{ ...on, textState: "fallback-text" }];
    case "broken-markup":
      // Puede sanear el markup o no mostrar el anuncio; nunca markup roto.
      return [{ moduleAvailable: true, textState: ["expected-locale", undefined] }];
    default:
      return [];
  }
}

const RULE = {
  ...Object.fromEntries(SHOW_ONCE.map((s) => [s, "show-once"])),
  ...Object.fromEntries(ROLLOUT.map((s) => [s, "rollout"])),
  ...Object.fromEntries(TARGETING.map((s) => [s, "targeting"])),
  keyboard: "keyboard",
  focus: "focus",
  "name-role-state": "name-role-state",
  close: "close",
  contrast: "contrast",
  "reduced-motion": "reduced-motion",
  "locale-fallback": "localization",
  "missing-content": "content-fallback",
  "broken-markup": "content-fallback",
};
const ruleFor = (id) => RULE[id];

module.exports = { REQUIRED_SCENARIOS, MESSAGES, REFS, DAY, T0, buildScenarios, expectationsFor, ruleFor, announcementFor };
