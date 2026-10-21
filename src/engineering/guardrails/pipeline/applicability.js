"use strict";

/**
 * Aplicabilidad antes de evaluar (T06.4; R5).
 *
 * 1. Perfiles: sólo `explicit`/`inherited` cuentan. Perfil ausente ⇒
 *    `not_applicable`; sólo sugerido ⇒ `unknown` (no se asume).
 * 2. Hook del control (puro, con datos congelados): puede afirmar
 *    `applicable`, `not_applicable`, `unknown` o `unavailable`.
 * Cualquier excepción del hook ⇒ `unknown`. Nunca se presume aplicable por
 * presencia de templates o archivos.
 */

const { createApplicability } = require("../contracts/applicability.js");
const { CONFIDENCE, deepFreeze } = require("../contracts/common.js");
const { profileRequirement } = require("../workspace/units.js");

function resolveApplicability({ unit, control, moment, scopeHash, observations, parameters, suggestions, hook }) {
  const base = { unitId: unit.id, controlId: control.id, moment, scopeHash, sources: [] };
  const req = profileRequirement(unit, control, suggestions || []);
  if (!req.satisfied) {
    const onlySuggested = req.missing.every((m) => m.status === "suggested");
    return createApplicability({
      ...base,
      status: onlySuggested ? "unknown" : "not_applicable",
      confidence: onlySuggested ? CONFIDENCE.UNKNOWN : CONFIDENCE.DETERMINISTIC,
      reasons: req.missing.map((m) => ({
        code: m.status === "suggested" ? "PROFILE_SUGGESTED_ONLY" : "PROFILE_NOT_DECLARED",
        message:
          m.status === "suggested"
            ? `el perfil '${m.id}' sólo fue sugerido por discovery; acéptelo en la config para evaluar`
            : `la unidad no declara el perfil '${m.id}'`,
      })),
      profileRefs: [],
    });
  }
  const profileRefs = req.matched.map((m) => ({ id: m.id, version: m.version }));
  if (!hook) {
    return createApplicability({ ...base, status: "applicable", confidence: CONFIDENCE.DETERMINISTIC, reasons: [], profileRefs });
  }
  let verdict;
  try {
    verdict = hook(
      deepFreeze(JSON.parse(JSON.stringify({ moment, parameters, profiles: profileRefs, observations })))
    );
  } catch (err) {
    verdict = null;
  }
  if (!verdict || typeof verdict !== "object") {
    return createApplicability({
      ...base,
      status: "unknown",
      confidence: CONFIDENCE.UNKNOWN,
      reasons: [{ code: "APPLICABILITY_ERROR", message: "el hook de aplicabilidad falló o no devolvió veredicto" }],
      profileRefs,
    });
  }
  try {
    return createApplicability({
      ...base,
      status: verdict.status,
      confidence: verdict.confidence,
      reasons: verdict.reasons || [],
      sources: verdict.sources || [],
      profileRefs: verdict.status === "applicable" ? profileRefs : [],
    });
  } catch (err) {
    return createApplicability({
      ...base,
      status: "unknown",
      confidence: CONFIDENCE.UNKNOWN,
      reasons: [{ code: "APPLICABILITY_INVALID", message: "veredicto de aplicabilidad inválido" }],
      profileRefs,
    });
  }
}

module.exports = { resolveApplicability };
