"use strict";

/**
 * JSON canónico (claves ordenadas, sin espacios) y hashes SHA-256 en el
 * formato `sha256:<hex>` que usan los contratos. Base de la reproducibilidad:
 * misma entrada semántica ⇒ mismo hash, independiente del orden de claves.
 */

const crypto = require("node:crypto");

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("canonicalJson: número no finito");
    }
    if (value === undefined || typeof value === "function") {
      throw new TypeError("canonicalJson: valor no serializable");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** `sha256:<hex>` de bytes/strings. */
function sha256Of(data) {
  return `sha256:${sha256Hex(data)}`;
}

/** `sha256:<hex>` del JSON canónico de un valor. */
function hashJson(value) {
  return sha256Of(canonicalJson(value));
}

module.exports = { canonicalJson, sha256Hex, sha256Of, hashJson };
