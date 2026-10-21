"use strict";

/**
 * Evaluator puro de `nav.broken-routes` (T30). Determinista: contrato
 * inválido y escenarios fallidos. Detectar un router sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de rutas (ruta del archivo, JSON, rutas únicas y schema nav-broken-routes.contract).",
  "route-match": "Una ruta declarada debe abrir su pantalla.",
  "not-found-page": "Una ruta inexistente debe mostrar una página de 'no encontrado', no una pantalla en blanco ni un error.",
  "exit-link": "La página de 'no encontrado' debe ofrecer una salida (ir al inicio o volver).",
  "malformed-url": "Una URL mal formada no debe romper la app: muestre 'no encontrado' o la ruta válida más cercana.",
  "auth-redirect": "Un enlace a una ruta protegida sin sesión debe llevar al login.",
  "return-after-login": "Después del login, lleve al usuario al destino del enlace original.",
  "keep-query": "Conserve los parámetros del enlace original (p. ej. ?tab=) al volver del login.",
};
const SEVERITY = { "not-found-page": "high", "malformed-url": "high", "return-after-login": "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "nav.broken-routes",
  prefix: "nbr",
  paramName: "routesContract",
  contractKind: "routes-contract",
  behaviorKind: "routes-behavior",
  signalsKind: "routes-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "routes-confirmation",
  heuristicRemediation: "Router inferido por patrón: declare las rutas en el contrato (routesContract). El patrón no prueba qué pasa con rutas rotas.",
  heuristicReason: "Rutas sin contrato: declárelas para verificar 'no encontrado', URLs mal formadas y enlaces tras el login.",
  missingContractReason: "Falta el contrato de rutas: no hay evidencia de qué pasa con rutas o enlaces rotos.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
