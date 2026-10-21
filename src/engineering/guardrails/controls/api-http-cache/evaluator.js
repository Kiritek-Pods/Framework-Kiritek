"use strict";

/**
 * Evaluator puro de `api.http-cache` (T42). Determinista: contrato inválido o
 * incoherente y escenarios fallidos (Cache-Control, validadores, 304 y
 * aislamiento entre usuarios). Detectar headers de caché sin contrato sólo
 * avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de caché (ruta, JSON, ids únicos y schema api-http-cache.contract).",
  "contract-max-age": "Los recursos públicos deben declarar maxAgeSeconds, sin superar parameters.maxAgeLimitSeconds.",
  "cache-control-missing": "Responda con Cache-Control explícito: sin él, cada proxy y navegador decide por su cuenta.",
  "max-age": "Los recursos públicos deben declarar el max-age (o s-maxage) del contrato.",
  "private-cacheable": "Los recursos privados deben responder Cache-Control: private o no-store, nunca public ni s-maxage: un proxy compartido podría servirlos a otra persona.",
  "validator-missing": "Responda con el validador declarado (ETag o Last-Modified).",
  "conditional-get": "Con If-None-Match / If-Modified-Since vigente responda 304 Not Modified.",
  "not-modified-body": "Una respuesta 304 no lleva cuerpo.",
  "stale-validator": "El validador debe cambiar cuando cambia el recurso: si no, el cliente se queda con datos viejos.",
  "cross-user-validator": "El ETag de un recurso privado debe depender de su contenido para ese usuario: otro usuario no puede recibir 304 con el validador ajeno.",
};
const SEVERITY = { "private-cacheable": "high", "cross-user-validator": "high", "stale-validator": "high", "contract-invalid": "high" };

function contractFindings(facts, params) {
  const limit = params.maxAgeLimitSeconds || 31536000;
  return facts.resources.filter((r) => (r.visibility === "public" && r.maxAgeSeconds === null) || (r.maxAgeSeconds !== null && r.maxAgeSeconds > limit)).map((r) => ({ rule: "contract-max-age", subject: r.id }));
}

module.exports = makeEvaluator({
  control: "api.http-cache",
  prefix: "ahc",
  paramName: "cacheContract",
  contractKind: "cache-contract",
  behaviorKind: "cache-behavior",
  signalsKind: "cache-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "cache-confirmation",
  heuristicRemediation: "Headers de caché inferidos por patrón: declare el contrato de caché (cacheContract). El patrón no prueba la política.",
  heuristicReason: "Caché HTTP sin contrato: declárelo para verificar Cache-Control, validadores y que nada privado quede en caché compartida.",
  missingContractReason: "Falta el contrato de caché HTTP: no hay evidencia de qué se cachea ni de que lo privado no se comparta.",
  contractFindings,
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
