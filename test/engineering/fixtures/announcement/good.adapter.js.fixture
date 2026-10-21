"use strict";
// Implementación de referencia (glue de un equipo) de un anuncio de módulo:
// show-once por clave/alcance/periodo, storage tolerante, ventana, audiencia,
// rollout, accesibilidad y fallback de contenido. `make(opts)` inyecta defectos.

const DAY = 86400000;
const strip = (s) => String(s).replace(/<[^>]*>?/g, "").replace(/\s+/g, " ").trim();

function make(opts = {}) {
  return function createAnnouncementUnderTest(deps) {
    const { clock, storage, viewer, locale, messages, rollout, prefersReducedMotion, announcement: a } = deps;
    let sessionShown = false;
    let open = null;
    let focus = "origin";
    let focusIdx = -1;

    const scopeId = () => (a.showOnce.audienceScope === "user" ? viewer.userId : a.showOnce.audienceScope === "account" ? viewer.accountId : "device");
    const storeKey = () => `${a.showOnce.key}:${scopeId()}`;
    function seen() {
      try {
        const v = storage.getItem(storeKey());
        if (!v) return false;
        return clock.now() - Number(v) < a.showOnce.periodDays * DAY;
      } catch (err) {
        if (opts.crashOnStorage) throw err;
        return null;
      }
    }
    function markSeen() {
      try {
        storage.setItem(storeKey(), String(clock.now()));
      } catch (err) {
        if (opts.crashOnStorage) throw err;
      }
    }
    function eligible() {
      const now = clock.now();
      if (now < a.window.start || now >= a.window.end) return false;
      if (rollout.state() !== "active") return false;
      return a.audience.criteria.every((c) => (c.operator === "in" ? c.values.includes(viewer[c.attribute]) : !c.values.includes(viewer[c.attribute])));
    }
    function content() {
      const pick = (loc) => {
        const m = messages[loc] || {};
        return { title: m[a.content.titleRef], body: m[a.content.bodyRef] };
      };
      let t = pick(locale);
      if (opts.rawKeys && (!t.title || !t.body)) return { title: a.content.titleRef, body: a.content.bodyRef };
      if (!t.title || !t.body) t = pick(a.content.defaultLocale);
      if (!t.title || !t.body) return a.content.missingContent === "hide" ? null : { title: "Novedades", body: "Hay una novedad disponible en este módulo." };
      return opts.rawMarkup ? t : { title: strip(t.title), body: strip(t.body) };
    }
    const controls = () => [
      { id: "close", name: opts.unnamedControls ? "" : "Cerrar anuncio", keyboard: true },
      { id: "primary", name: opts.unnamedControls ? "" : "Ver el módulo", keyboard: !opts.mouseOnly },
    ];
    function snapshot() {
      const available = !(opts.retireHidesModule && rollout.state() !== "active");
      if (!open) return { moduleAvailable: available, focus, announcement: null, ...(opts.extra || {}) };
      return {
        moduleAvailable: available,
        focus,
        announcement: {
          role: "dialog",
          modal: false,
          name: open.title,
          title: open.title,
          body: open.body,
          controls: controls(),
          colors: opts.colors || { text: "#1a1a1a", background: "#ffffff" },
          motion: { animated: !!a.animated, durationMs: a.animated && (!prefersReducedMotion || opts.ignoreReducedMotion) ? 200 : 0 },
          ...(opts.extraAnnouncement || {}),
        },
        ...(opts.extra || {}),
      };
    }
    return {
      async render() {
        open = null;
        focus = "origin";
        if (eligible()) {
          const s = opts.noDedupe ? false : seen();
          const policy = a.showOnce.storageUnavailable;
          const show = s === null ? policy === "show" || (policy === "once-per-session" && !sessionShown) : !s;
          const c = show ? content() : null;
          if (c) {
            open = c;
            sessionShown = true;
            focus = opts.noFocus ? "origin" : "announcement";
            focusIdx = -1;
            markSeen();
          }
        }
        return snapshot();
      },
      async press(key) {
        if (!open) return snapshot();
        const reachable = controls().filter((c) => c.keyboard);
        if (key === "Tab" && reachable.length) {
          focusIdx = (focusIdx + 1) % reachable.length;
          focus = `control:${reachable[focusIdx].id}`;
        } else if (key === "Escape" && !opts.trapEscape) {
          open = null;
          focus = "origin";
        }
        return snapshot();
      },
    };
  };
}

module.exports = { make, createAnnouncementUnderTest: make() };
