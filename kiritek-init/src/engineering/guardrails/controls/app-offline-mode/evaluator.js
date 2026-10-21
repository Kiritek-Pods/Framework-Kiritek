"use strict";

/**
 * Evaluator puro de `app.offline-mode` (T28). Determinista: contrato inválido
 * y escenarios fallidos. Detectar service workers o almacenamiento local sin
 * contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de modo sin conexión (ruta, JSON, ids únicos y schema app-offline-mode.contract).",
  "offline-indicator": "Avise mientras no hay conexión y quite el aviso cuando vuelve.",
  "online-send": "Con conexión, la acción debe enviarse una vez y confirmarse.",
  "offline-accept": "Sin conexión, acepte la acción (encolada) sin mostrar error al usuario.",
  "sync-once": "Al volver la conexión, envíe cada acción encolada exactamente una vez.",
  "queue-drain": "Tras sincronizar, la cola debe quedar vacía.",
  "persist-queue": "Guarde la cola en almacenamiento persistente: debe sobrevivir a cerrar y abrir la app.",
  "sync-order": "Sincronice las acciones en el orden en que el usuario las hizo.",
  "online-only": "Una acción que sólo funciona con conexión debe rechazarse sin red (y no enviarse después a escondidas).",
};
const SEVERITY = { "sync-once": "high", "persist-queue": "high", "online-only": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "app.offline-mode",
  prefix: "aom",
  paramName: "offlineContract",
  contractKind: "offline-contract",
  behaviorKind: "offline-behavior",
  signalsKind: "offline-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "offline-confirmation",
  heuristicRemediation: "Soporte sin conexión inferido por patrón (service worker, navigator.onLine…): declare el contrato (offlineContract). El patrón no prueba la sincronización.",
  heuristicReason: "Soporte sin conexión sin contrato: declárelo para verificar aviso, cola y sincronización.",
  missingContractReason: "Falta el contrato de modo sin conexión: no hay evidencia de qué pasa sin red.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
