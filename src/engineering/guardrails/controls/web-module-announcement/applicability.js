"use strict";

/**
 * Aplicabilidad (pura): perfiles `web` + `module-launch` ya exigidos por el
 * pipeline. Manifest declarado (válido o no) ⇒ aplicable determinista; sin
 * manifest ⇒ aplicable `medium` sólo para sugerir (nunca bloquea; R11.10).
 */
function applicability({ observations }) {
  const m = observations.find((o) => o.kind === "announcement-manifest");
  if (!m) return { status: "unknown", confidence: "unknown", reasons: [{ code: "MANIFEST_OBSERVATION_MISSING", message: "no se observó el launch manifest" }] };
  if (!m.facts.declared) {
    return {
      status: "applicable",
      confidence: "medium",
      reasons: [{ code: "LAUNCH_MANIFEST_MISSING", message: "perfil module-launch sin launch manifest explícito" }],
      sources: [m.observationId],
    };
  }
  return { status: "applicable", confidence: "deterministic", reasons: [], sources: [m.observationId] };
}

module.exports = { applicability };
