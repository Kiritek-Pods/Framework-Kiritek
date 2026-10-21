"use strict";

/**
 * Error operativo de engineering/guardrails con código estable, puntero JSON
 * opcional y remediación (design §20). Nunca transporta valores sensibles:
 * quien lo lanza describe ubicación y causa, no el contenido.
 */
class GuardrailsError extends Error {
  /**
   * @param {string} code         Código estable (CATALOG_*, CONFIG_*...).
   * @param {string} message      Causa redactada.
   * @param {object} [details]
   * @param {string} [details.pointer]     JSON Pointer o ubicación.
   * @param {string} [details.remediation] Paso concreto para corregir.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GuardrailsError";
    this.code = code;
    if (details.pointer !== undefined) this.pointer = details.pointer;
    if (details.remediation !== undefined) this.remediation = details.remediation;
  }

  toDiagnostic(stage) {
    const d = { code: this.code, message: this.message };
    if (stage) d.stage = stage;
    if (this.remediation) d.remediation = this.remediation;
    return d;
  }
}

function raise(code, message, details) {
  throw new GuardrailsError(code, message, details);
}

module.exports = { GuardrailsError, raise };
