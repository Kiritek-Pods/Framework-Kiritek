"use strict";

/**
 * Escenarios de `i18n.formatting` (T27.2). La referencia es `Intl` de la
 * plataforma: no se exige un texto exacto, sólo las convenciones del idioma
 * (orden día/mes, separador decimal, moneda, zona horaria, idioma de respaldo).
 */

const MAX_LOCALES = 5;
const PER_LOCALE = ["date", "number", "currency", "timezone"];

/** Locale de la traza (minúsculas, sin colisión con el validador de privacidad). */
const slug = (locale) => locale.toLowerCase();

function scenariosFor(facts) {
  const out = [];
  for (const loc of facts.locales.slice(0, MAX_LOCALES)) for (const f of PER_LOCALE) if (facts.formats.includes(f)) out.push(`${f}@${slug(loc)}`);
  if (facts.formats.includes("messages")) out.push("fallback", "missing-key");
  return out;
}

const requiredScenarios = (facts) => scenariosFor(facts);

function expectationsFor(id) {
  if (id === "missing-key") return [{ threw: false, message: "ok" }];
  return [{ threw: false, ok: true }];
}

const RULES = { date: "date-format", number: "number-format", currency: "currency-format", timezone: "time-zone", fallback: "locale-fallback", "missing-key": "missing-message" };
function ruleFor(id, fact) {
  const scenario = id.split("@")[0];
  if (fact === "threw") return "formatter-error";
  return RULES[scenario];
}

module.exports = { MAX_LOCALES, PER_LOCALE, slug, scenariosFor, requiredScenarios, expectationsFor, ruleFor };
