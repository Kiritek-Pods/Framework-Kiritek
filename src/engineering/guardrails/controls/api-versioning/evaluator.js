"use strict";

/**
 * Evaluator puro de `api.versioning` (T40). Determinista: contrato inválido o
 * incoherente y escenarios fallidos (versiones servidas, avisos de
 * deprecación, versiones desconocidas o retiradas y campos que se rompen).
 * Detectar rutas versionadas sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de versionado (ruta, JSON, ids únicos y schema api-versioning.contract).",
  "contract-versions": "Declare al menos una versión vigente (status supported).",
  "sunset-passed": "La fecha de retiro (sunset) ya pasó: retire la versión (status retired) o corrija la fecha.",
  "version-served": "Cada versión vigente o deprecada debe seguir respondiendo 2xx hasta su retiro.",
  "deprecation-header": "Las versiones deprecadas deben responder con el header Deprecation.",
  "sunset-header": "Las versiones deprecadas con fecha de retiro deben responder con el header Sunset (HTTP-date) de esa fecha.",
  "false-deprecation": "No marque como deprecada una versión vigente.",
  "unknown-version": "Una versión inexistente debe responder 4xx, no 5xx ni la versión más nueva en silencio.",
  "retired-version": "Una versión retirada debe responder 410 (o 404).",
  "breaking-change": "No quite campos de una versión publicada: los clientes que la usan se rompen. Agréguelos en una versión nueva.",
};
const SEVERITY = { "breaking-change": "high", "version-served": "high", "contract-invalid": "high" };

function contractFindings(facts, _params, nowIso) {
  const out = [];
  if (!facts.versions.some((v) => v.status === "supported")) out.push({ rule: "contract-versions" });
  const today = String(nowIso || "").slice(0, 10);
  for (const v of facts.versions) if (v.status === "deprecated" && v.sunset && today && v.sunset < today) out.push({ rule: "sunset-passed", subject: v.id });
  return out;
}

module.exports = makeEvaluator({
  control: "api.versioning",
  prefix: "avs",
  paramName: "versioningContract",
  contractKind: "versioning-contract",
  behaviorKind: "versioning-behavior",
  signalsKind: "versioning-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "versioning-confirmation",
  heuristicRemediation: "Ruta versionada inferida por patrón: declare las versiones en el contrato de versionado (versioningContract). El patrón no prueba la compatibilidad.",
  heuristicReason: "Versiones de API sin contrato: declárelas para verificar que las viejas sigan funcionando y avisen su retiro.",
  missingContractReason: "Falta el contrato de versionado: no hay evidencia de que los cambios no rompan a los clientes.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
