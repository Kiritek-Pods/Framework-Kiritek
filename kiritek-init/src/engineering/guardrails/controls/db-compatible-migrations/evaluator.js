"use strict";

/**
 * Evaluator puro de `db.compatible-migrations` (T46). Determinista: contrato
 * inválido, migraciones ilegibles o baseline inexistente, cambios
 * incompatibles con el código desplegado en migraciones posteriores al
 * baseline y contracciones sin expansión desplegada. Detectar archivos de
 * migración sin contrato sólo avisa.
 */

const { makeEvaluator } = require("../shared/behavior-evaluator.js");
const { requiredScenarios, expectationsFor, ruleFor } = require("./scenarios.js");

const REMEDIATION = {
  "contract-invalid": "Corrija el contrato de migraciones (ruta, JSON, ids únicos y schema db-compatible-migrations.contract).",
  "migrations-unreadable": "El adapter debe devolver las migraciones en orden como [{ id, sql }] e incluir el baseline declarado.",
  "drop-column": "No borre columnas que el código desplegado todavía lee: deje de usarlas en un release y bórrelas en el siguiente (declárelo en contractPhase).",
  rename: "No renombre columnas ni tablas en un paso: agregue la nueva, escriba en ambas, migre los datos y quite la vieja después.",
  "drop-table": "No borre tablas que el código desplegado todavía usa: hágalo en una migración de contracción posterior.",
  "type-change": "No cambie el tipo de una columna en uso: agregue una columna nueva con el tipo correcto y migre.",
  "not-null-without-default": "Una columna NOT NULL sin DEFAULT rompe los INSERT del código desplegado: agréguela con DEFAULT o nullable y ajústela después.",
  "blocking-index": "En Postgres cree índices sobre tablas existentes con CREATE INDEX CONCURRENTLY, para no bloquear escrituras.",
  "contract-without-expand": "Cada migración de contracción debe referir a su expansión (expandedBy), ya desplegada en o antes del baseline.",
};
const SEVERITY = { "drop-column": "high", "drop-table": "high", rename: "high", "contract-invalid": "high" };

module.exports = makeEvaluator({
  control: "db.compatible-migrations",
  prefix: "dbm",
  paramName: "migrationsContract",
  contractKind: "migrations-contract",
  behaviorKind: "migrations-behavior",
  signalsKind: "migrations-signals",
  remediation: REMEDIATION,
  severity: SEVERITY,
  heuristicRule: "migrations-confirmation",
  heuristicRemediation: "Migraciones inferidas por patrón: declare el contrato de migraciones (migrationsContract) y el adapter que las entrega.",
  heuristicReason: "Migraciones de base sin contrato: declárelo para verificar que no rompen al código desplegado durante el deploy.",
  missingContractReason: "Falta el contrato de migraciones: no hay evidencia de que los cambios de base sean compatibles hacia atrás.",
  contractFindings: () => [],
  requiredScenarios: (facts) => requiredScenarios(facts),
  expectationsFor,
  ruleFor,
});
module.exports.REMEDIATION = REMEDIATION;
