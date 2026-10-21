"use strict";

/**
 * Escenarios de `ui.form-validation` (T19.2). Valores sintéticos por formato;
 * la traza nunca los incluye.
 */

const MAX_FORMS = 5;
const VALID = { email: "ana@example.test", number: "42", url: "https://example.test/a", phone: "+56 9 1234 5678", text: "Texto válido" };
const INVALID = { email: "ana@", number: "cuarenta", url: "no es url", phone: "llamar", text: null };

function validValue(f) {
  let v = VALID[f.format];
  if (f.format === "text") {
    if (f.minLength && v.length < f.minLength) v = v.padEnd(f.minLength, "x");
    if (f.maxLength && v.length > f.maxLength) v = v.slice(0, f.maxLength);
  }
  return v;
}

function invalidValue(f) {
  if (f.format !== "text") return INVALID[f.format];
  if (f.minLength && f.minLength > 1) return "x".repeat(f.minLength - 1);
  if (f.maxLength) return "x".repeat(f.maxLength + 1);
  return null;
}

/** Escenarios aplicables a un formulario según sus campos. */
function scenariosFor(form) {
  const hasRequired = form.fields.some((f) => f.required);
  const hasConstrained = form.fields.some((f) => invalidValue(f) !== null);
  return [hasRequired && "required", hasConstrained && "format", "valid-submit", "double-submit", "server-error", hasRequired && "error-clears"].filter(Boolean);
}

const split = (id) => {
  const [scenario, form] = id.split("@");
  return { scenario, form };
};

function requiredScenarios(facts) {
  return facts.forms.slice(0, MAX_FORMS).flatMap((f) => scenariosFor(f).map((s) => `${s}@${f.id}`));
}

function expectationsFor(id) {
  switch (split(id).scenario) {
    case "required":
      return [{ submits: 0, requiredFlagged: true, linked: true, focusFirst: true, message: "ok" }];
    case "format":
      return [{ submits: 0, formatFlagged: true, noFalseErrors: true, linked: true, message: "ok" }];
    case "valid-submit":
      return [{ submits: 1, valuesSent: true, noFalseErrors: true, status: "submitted" }];
    case "double-submit":
      return [{ submits: 1 }];
    case "server-error":
      return [{ preserved: true, announced: true, status: "error" }, { resubmitted: true }];
    case "error-clears":
      return [{ cleared: true }];
    default:
      return [];
  }
}

const RULES = {
  required: { submits: "blocks-invalid-submit", requiredFlagged: "required", linked: "error-linked", focusFirst: "focus-first-invalid", message: "message-text" },
  format: { submits: "blocks-invalid-submit", formatFlagged: "format", noFalseErrors: "false-error", linked: "error-linked", message: "message-text" },
  "valid-submit": { noFalseErrors: "false-error", default: "submit" },
  "double-submit": { default: "double-submit" },
  "server-error": { preserved: "preserve-input", announced: "error-announced", status: "error-announced", default: "resubmit" },
  "error-clears": { default: "error-clears" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default || "submit";
}

module.exports = { MAX_FORMS, validValue, invalidValue, scenariosFor, requiredScenarios, expectationsFor, ruleFor, split };
