"use strict";

// Adapter de referencia de app.device-permissions (no-rationale): pide sin explicar
const OPTS = {"noRationale":true};

exports.createPermissionsUnderTest = ({ platform, permissions }) => {
  
  let screen = "app";
  let rationale = false;
  let fallback = false;
  let settingsLink = false;
  const asked = new Set();
  return {
    async launch() {
      if (OPTS.askOnLaunch) for (const p of permissions) await platform.request(p.kind);
    },
    async useFeature(id) {
      const p = permissions.find((x) => x.id === id);
      const st = platform.status(p.kind);
      if (st === "granted") return { ok: true };
      if ((st === "blocked" || (st === "denied" && !OPTS.reprompt)) && !OPTS.ignoreBlocked) {
        settingsLink = !OPTS.noSettingsLink;
        fallback = p.fallback === "required" && !OPTS.noFallback;
        return { ok: false };
      }
      if (asked.has(p.id) && !OPTS.reprompt) return { ok: false };
      rationale = !OPTS.noRationale;
      asked.add(p.id);
      const r = await platform.request(p.kind);
      rationale = false;
      if (r === "granted") return { ok: true };
      if (OPTS.crashOnDeny) {
        screen = "error";
        throw new Error("permiso negado");
      }
      fallback = p.fallback === "required" && !OPTS.noFallback;
      settingsLink = r === "blocked" && !OPTS.noSettingsLink;
      return { ok: false };
    },
    view: () => ({ screen, rationale, fallback, settingsLink }),
  };
};
