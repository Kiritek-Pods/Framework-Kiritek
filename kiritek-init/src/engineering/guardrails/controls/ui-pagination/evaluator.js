"use strict";

/**
 * Evaluator puro de `ui.pagination` (T24). Determinista: contrato inválido o
 * con páginas demasiado grandes y escenarios fallidos. Detectar listas sin
 * contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de listas (ruta, JSON, ids únicos y schema ui-pagination.contract).",
  "contract-page-size": "pageSize supera parameters.maxPageSize: páginas grandes cargan de más.",
  "first-page": "Al montar, cargue sólo la primera página (una petición, pageSize ítems).",
  "page-size": "Pida exactamente pageSize ítems por página.",
  complete: "Paginando hasta el final deben aparecer todos los ítems.",
  duplicates: "No repita ítems al paginar.",
  order: "Conserve el orden de la fuente al agregar páginas.",
  "end-state": "Indique cuando no hay más ítems (fin de la lista).",
  "extra-requests": "Use nextCursor/hasMore para saber cuándo terminar; no pida páginas de más.",
  "load-after-end": "Una vez en el fin de la lista, no vuelva a pedir páginas.",
  "concurrent-load": "Ignore un segundo 'cargar más' mientras hay una página en vuelo (sin duplicados).",
  "keep-on-error": "Si una página falla, conserve los ítems ya cargados.",
  "error-state": "Si una página falla, muéstrelo con opción de reintentar.",
  retry: "Reintentar tras el error debe cargar la página que faltaba, sin duplicados.",
  "stable-cursor": "Pagine por cursor: si llegan ítems nuevos arriba, no repita ni salte ítems.",
};
const SEVERITY = { duplicates: "high", complete: "high", "keep-on-error": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "ui.pagination",
  prefix: "upg",
  paramName: "listsContract",
  contractKind: "lists-contract",
  behaviorKind: "lists-behavior",
  signalsKind: "lists-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "lists-confirmation",
  heuristicRemediation: "Lista paginada inferida por patrón: declárela en el contrato de listas (listsContract). El patrón no prueba la paginación.",
  heuristicReason: "Listas paginadas sin contrato: declárelas para verificar páginas, duplicados y fin de lista.",
  missingContractReason: "Falta el contrato de listas paginadas: no hay evidencia de que la paginación no repita ni salte ítems.",
  contractFindings: (facts, params) => facts.lists.filter((l) => l.pageSize > (params.maxPageSize || 200)).map((l) => ({ rule: "contract-page-size", subject: l.id })),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
