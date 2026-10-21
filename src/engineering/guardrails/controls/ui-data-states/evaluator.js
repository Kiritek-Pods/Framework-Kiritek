"use strict";

/**
 * Evaluator puro de `ui.data-states` (T18). Determinista: contrato inválido,
 * timeout declarado fuera de lo permitido y escenarios conductuales
 * fallidos. Detectar llamadas de red sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const CONTROL = "ui.data-states";

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de estados (ruta, JSON, ids de pantalla únicos y schema ui-data-states.contract).",
  "contract-timeout": "El timeoutMs de la pantalla supera parameters.maxTimeoutMs: acórtelo para que el usuario no espere indefinidamente.",
  "loading-state": "Mientras los datos cargan, la pantalla debe mostrar un estado de carga (nunca en blanco ni contenido viejo sin indicarlo).",
  "loading-announced": "Anuncie la carga a tecnologías de asistencia (aria-busy, live region o equivalente de la plataforma).",
  "content-state": "Con datos, la pantalla debe mostrar el contenido con todos los ítems recibidos.",
  "empty-state": "Sin datos, muestre un estado vacío explícito (no una lista en blanco ni un error).",
  "error-state": "Si la carga falla, muestre un estado de error; nunca quede en blanco ni en carga infinita.",
  "retry-available": "El estado de error debe ofrecer una acción de reintento visible.",
  retry: "Reintentar tras un error debe volver a cargar y mostrar el contenido.",
  timeout: "Si la carga no responde dentro del timeoutMs declarado, pase a estado de error con reintento.",
  "duplicate-request": "Montar la pantalla debe disparar una sola carga (sin pedidos duplicados).",
};
const SEVERITY = { "error-state": "high", timeout: "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: CONTROL,
  prefix: "uds",
  paramName: "statesContract",
  contractKind: "states-contract",
  behaviorKind: "states-behavior",
  signalsKind: "states-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "states-confirmation",
  heuristicRemediation: "Carga de datos inferida por patrón: declare la pantalla en el contrato de estados (statesContract). El patrón no prueba el comportamiento.",
  heuristicReason: "Carga de datos sin contrato de estados: declare las pantallas para verificar carga, vacío y error.",
  missingContractReason: "Falta el contrato de estados de pantalla: no hay evidencia de carga, vacío y error.",
  contractFindings: (facts, params) => facts.screens.filter((s) => params.maxTimeoutMs && s.timeoutMs > params.maxTimeoutMs).map((s) => ({ rule: "contract-timeout", subject: s.id })),
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
