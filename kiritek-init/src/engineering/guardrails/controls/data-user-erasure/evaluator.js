"use strict";

/**
 * Evaluator puro de `data.user-erasure` (T47). Determinista: contrato
 * inválido y escenarios fallidos (rastros en algún almacén, datos ajenos
 * borrados, datos que reaparecen en lecturas y errores al repetir o con un
 * usuario inexistente). Detectar lógica de borrado sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de borrado (ruta, JSON, ids únicos y schema data-user-erasure.contract).",
  "erasure-status": "El pedido de borrado debe responder 2xx (o 202 si sigue en segundo plano).",
  "erasure-incomplete": "Borre o anonimice los datos del usuario en este almacén: no deben quedar su id, email, teléfono ni nombre (un borrado lógico con los datos intactos no cuenta).",
  "collateral-deletion": "El borrado de un usuario no debe tocar los datos de otros.",
  "erased-reappears": "Los datos borrados no deben reaparecer en listados ni exportaciones (cachés, índices de búsqueda, réplicas).",
  "erasure-not-idempotent": "Repetir el borrado debe responder 2xx o 404, nunca 5xx.",
  "erasure-unknown-user": "Borrar un usuario inexistente debe responder 404 (o 2xx) sin borrar nada.",
};
const SEVERITY = { "erasure-incomplete": "high", "collateral-deletion": "high", "erased-reappears": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "data.user-erasure",
  prefix: "due",
  paramName: "erasureContract",
  contractKind: "erasure-contract",
  behaviorKind: "erasure-behavior",
  signalsKind: "erasure-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "erasure-confirmation",
  heuristicRemediation: "Borrado de cuentas inferido por patrón: declare el contrato de borrado (erasureContract) con todos los almacenes que guardan datos del usuario.",
  heuristicReason: "Borrado de datos del usuario sin contrato: declárelo para verificar que no quedan rastros en ningún almacén.",
  missingContractReason: "Falta el contrato de borrado de datos del usuario: no hay evidencia de que 'borrar mi cuenta' borre todo.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
