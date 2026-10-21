"use strict";

/**
 * Escenarios de `ui.file-upload` (T23.2). Archivos sintéticos (nombre, tipo
 * y tamaño; sin contenido). El transporte reporta progreso por timers.
 */

const MAX_UPLOADS = 5;
const WRONG_TYPE = "application/x-msdownload";

const acceptsAny = (u) => u.accept.includes("*/*");
const typeMatches = (accept, type) => accept.some((a) => a === "*/*" || a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));

/** Tipo aceptado concreto para el archivo válido. */
function acceptedType(u) {
  const a = u.accept[0];
  if (a === "*/*") return "application/octet-stream";
  if (a.endsWith("/*")) return `${a.slice(0, -2)}/x-kiritek`;
  return a;
}

function scenariosFor(u) {
  return ["accept", "too-large", !acceptsAny(u) && !typeMatches(u.accept, WRONG_TYPE) && "wrong-type", u.cancel === "required" && "cancel", "network-error", "double-start"].filter(Boolean);
}

const split = (id) => {
  const [scenario, upload] = id.split("@");
  return { scenario, upload };
};

const requiredScenarios = (facts) => facts.uploads.slice(0, MAX_UPLOADS).flatMap((u) => scenariosFor(u).map((s) => `${s}@${u.id}`));

function expectationsFor(id, params) {
  const { scenario, upload } = split(id);
  const u = (params.uploads || []).find((x) => x.id === upload) || {};
  switch (scenario) {
    case "accept":
      return [{ state: "done", progressSeen: true, uploads: 1 }];
    case "too-large":
    case "wrong-type":
      return [{ state: "rejected", uploads: 0, message: "ok" }];
    case "cancel":
      return [{ state: "cancelled", aborted: true }];
    case "network-error":
      return u.retry === "required" ? [{ state: "error" }, { retried: true }] : [{ state: "error" }];
    case "double-start":
      return [{ state: "done", uploads: 1 }];
    default:
      return [];
  }
}

const RULES = {
  accept: { progressSeen: "progress", default: "upload-complete" },
  "too-large": { message: "message-text", default: "size-limit" },
  "wrong-type": { message: "message-text", default: "type-check" },
  cancel: { default: "cancel" },
  "network-error": { retried: "retry", default: "error-state" },
  "double-start": { uploads: "duplicate-upload", default: "upload-complete" },
};
function ruleFor(id, fact) {
  const r = RULES[split(id).scenario] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_UPLOADS, WRONG_TYPE, acceptedType, typeMatches, scenariosFor, requiredScenarios, expectationsFor, ruleFor, split };
