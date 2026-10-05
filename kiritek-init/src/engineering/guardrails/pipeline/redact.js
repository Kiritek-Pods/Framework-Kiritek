"use strict";

/**
 * Verificación de privacidad previa a publicar el reporte (T06.1, paso
 * "redactor"). Versión mínima: falla cerrado si el reporte contiene campos
 * prohibidos, rutas absolutas o valores con forma de credencial. La
 * minimización/redacción completa y los canarios llegan en T08.
 */

const { FORBIDDEN_FIELDS } = require("../contracts/common.js");
const { looksLikeSecret } = require("../config/validate.js");
const { raise } = require("../errors.js");

// `code` es nombre de campo estructural de Diagnostic (código de error).
const FORBIDDEN = new Set(FORBIDDEN_FIELDS.filter((f) => f !== "code"));
const ABSOLUTE_RE = /(^|[\s(:'"])(\/(?:Users|home|root|var|tmp|private|etc|opt)\/|[A-Za-z]:\\)/;

function assertPublishable(report) {
  const problems = [];
  (function walk(v, where) {
    if (typeof v === "string") {
      if (ABSOLUTE_RE.test(v)) problems.push(`${where}: ruta absoluta`);
      if (looksLikeSecret(v)) problems.push(`${where}: valor con forma de credencial`);
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN.has(k)) problems.push(`${where}.${k}: campo prohibido`);
        walk(x, `${where}.${k}`);
      }
    }
  })(report, "$");
  if (problems.length) {
    raise("REDACTION_FAILED", `el reporte no se publica: ${problems.slice(0, 5).join("; ")}`, {
      remediation: "Corrija el control/collector que filtró datos; el reporte no se escribe ni se envía.",
    });
  }
  return report;
}

module.exports = { assertPublishable };
