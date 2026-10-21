"use strict";

/**
 * Evaluator puro de `api.response-schema` (T43). Determinista: contrato
 * inválido, schemas con palabras clave que no se pueden verificar y
 * respuestas reales que no cumplen el schema declarado. Detectar specs u
 * objetos de schema sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");
const { unsupported } = require("./schema-subset.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de schemas de respuesta (ruta, JSON, ids únicos y schema api-response-schema.contract).",
  "contract-schema-unsupported": "El schema usa palabras clave que no se pueden verificar (oneOf, allOf, if, $ref externos…): reescríbalo con type, properties, required, items, enum, anyOf y $ref locales.",
  "response-status": "El endpoint debe responder el código de éxito declarado.",
  "schema-mismatch": "La respuesta real no cumple su schema (tipos, requeridos, enums o nulos no declarados): corrija la respuesta o el schema publicado.",
  "undeclared-field": "La respuesta trae campos que el schema no declara: quítelos (pueden filtrar datos internos) o documéntelos.",
  "error-status": "Un cuerpo inválido debe responder 4xx.",
  "error-schema": "Las respuestas de error deben cumplir el errorSchema declarado.",
};
const SEVERITY = { "schema-mismatch": "high", "undeclared-field": "high", "contract-invalid": "high" };

function contractFindings(facts) {
  const out = [];
  for (const e of facts.endpoints) if (unsupported(JSON.parse(e.responseSchema)).length) out.push({ rule: "contract-schema-unsupported", subject: e.id });
  if (facts.errorSchema && unsupported(JSON.parse(facts.errorSchema)).length) out.push({ rule: "contract-schema-unsupported", subject: "error" });
  return out;
}

module.exports = makeEvaluator({
  control: "api.response-schema",
  prefix: "ars",
  paramName: "responseSchemaContract",
  contractKind: "respschema-contract",
  behaviorKind: "respschema-behavior",
  signalsKind: "respschema-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "schema-confirmation",
  heuristicRemediation: "Spec o schema de API inferido por patrón: declare los schemas de respuesta en el contrato (responseSchemaContract). El patrón no prueba que las respuestas lo cumplan.",
  heuristicReason: "Respuestas de API sin contrato de schema: declárelo para verificar que la documentación coincide con lo que la API responde.",
  missingContractReason: "Falta el contrato de schemas de respuesta: no hay evidencia de que la API responda lo que documenta.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
