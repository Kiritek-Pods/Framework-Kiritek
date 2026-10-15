"use strict";

/**
 * Clase de un mensaje mostrado al usuario, sin copiarlo: `ok`, `empty`,
 * `internal-key` (p. ej. "errors.required") o `markup` (HTML crudo).
 */
function messageState(text) {
  if (typeof text !== "string" || !text.trim()) return "empty";
  const t = text.trim();
  if (/[<>]/.test(t)) return "markup";
  if (/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i.test(t)) return "internal-key";
  return "ok";
}

module.exports = { messageState };
