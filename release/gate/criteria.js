"use strict";

/**
 * Criterios del gate de release de la iniciativa (T17). Cada criterio T17.x
 * agrupa los tests que lo demuestran y los chequeos estáticos que el gate
 * corre por su cuenta.
 *
 * Los criterios globales G1–G7 no tienen definición textual en la spec; su
 * lectura aquí se infiere de cómo tasks.md los asigna a cada tarea:
 *   G1 separación de security (config, niveles, promoción, auditoría, uninstall)
 *   G2 aplicabilidad explícita y resolución reproducible (perfiles, unidades, catálogo, config)
 *   G3 detección conductual/contractual atribuible al alcance
 *   G4 resultados honestos: errores operativos, vigencia, waivers/N/A y rollback
 *   G5 enforcement seguro: ninguna ruta heurística u operativa hacia deny
 *   G6 versionado, compatibilidad, supply chain y documentación operativa
 *   G7 privacidad y observabilidad sin datos sensibles
 */

const CRITERIA = Object.freeze([
  {
    id: "T17.1",
    title: "Instalación idempotente y aislamiento total respecto de security",
    goals: ["G1"],
    requirements: ["R1", "R17", "R27.1"],
    tests: ["unit/domain-separation.test.js", "unit/contracts.test.js", "integration/cli-install.test.js", "integration/lifecycle.test.js"],
    checks: [],
  },
  {
    id: "T17.2",
    title: "Resolución reproducible de perfiles/unidades/catálogo/config y cobertura monorepo",
    goals: ["G2"],
    requirements: ["R2", "R3", "R4", "R5", "R14", "R27.2"],
    tests: ["unit/catalog.test.js", "unit/config.test.js", "unit/workspace-units.test.js", "unit/workspace-scope.test.js", "property/fuzz.property.test.js"],
    checks: [],
  },
  {
    id: "T17.3",
    title: "Los controles detectan sus fallos conductuales sin imponer librerías o frameworks",
    goals: ["G3"],
    requirements: ["R9", "R10", "R11", "R28", "R29", "R30", "R31", "R32", "R33", "R34", "R35", "R36", "R37", "R38", "R39", "R40", "R41", "R42", "R43", "R44", "R45", "R46", "R47", "R48", "R49", "R50", "R51", "R52", "R53", "R54", "R55", "R56", "R57", "R58", "R59", "R27.3"],
    tests: [
      "controls/search-input-rate.test.js",
      "controls/app-minimum-supported-version.test.js",
      "controls/web-module-announcement.test.js",
      "contract/search-input-rate.test.js",
      "contract/app-minimum-supported-version.test.js",
      "contract/web-module-announcement.test.js",
      "controls/ui-data-states.test.js",
      "controls/ui-form-validation.test.js",
      "controls/net-resilient-requests.test.js",
      "controls/flags-lifecycle.test.js",
      "controls/behavior-collector.test.js",
      "contract/ui-data-states.test.js",
      "contract/ui-form-validation.test.js",
      "contract/net-resilient-requests.test.js",
      "contract/flags-lifecycle.test.js",
      "controls/auth-session-expiry.test.js",
      "controls/ui-file-upload.test.js",
      "controls/ui-pagination.test.js",
      "controls/analytics-events.test.js",
      "contract/auth-session-expiry.test.js",
      "contract/ui-file-upload.test.js",
      "contract/ui-pagination.test.js",
      "contract/analytics-events.test.js",
      "controls/ui-destructive-actions.test.js",
      "controls/i18n-formatting.test.js",
      "controls/app-offline-mode.test.js",
      "contract/ui-destructive-actions.test.js",
      "contract/i18n-formatting.test.js",
      "contract/app-offline-mode.test.js",
      "controls/app-device-permissions.test.js",
      "controls/nav-broken-routes.test.js",
      "controls/ui-accessible-dialogs.test.js",
      "contract/app-device-permissions.test.js",
      "contract/nav-broken-routes.test.js",
      "contract/ui-accessible-dialogs.test.js",
      "controls/api-idempotency.test.js",
      "contract/api-idempotency.test.js",
      "controls/api-error-responses.test.js",
      "contract/api-error-responses.test.js",
      "controls/api-rate-limit.test.js",
      "contract/api-rate-limit.test.js",
      "controls/api-pagination.test.js",
      "contract/api-pagination.test.js",
      "controls/svc-dependency-failure.test.js",
      "contract/svc-dependency-failure.test.js",
      "controls/svc-health-shutdown.test.js",
      "contract/svc-health-shutdown.test.js",
      "controls/svc-log-hygiene.test.js",
      "contract/svc-log-hygiene.test.js",
      "controls/api-concurrency.test.js",
      "contract/api-concurrency.test.js",
      "controls/api-versioning.test.js",
      "contract/api-versioning.test.js",
      "controls/api-request-limits.test.js",
      "contract/api-request-limits.test.js",
      "controls/api-http-cache.test.js",
      "contract/api-http-cache.test.js",
      "controls/api-response-schema.test.js",
      "contract/api-response-schema.test.js",
      "controls/api-long-operations.test.js",
      "contract/api-long-operations.test.js",
      "controls/api-batch.test.js",
      "contract/api-batch.test.js",
      "controls/db-compatible-migrations.test.js",
      "contract/db-compatible-migrations.test.js",
      "controls/data-user-erasure.test.js",
      "contract/data-user-erasure.test.js",
      "controls/svc-metrics.test.js",
      "contract/svc-metrics.test.js",
      "controls/svc-startup-config.test.js",
      "contract/svc-startup-config.test.js",
    ],
    checks: ["conformance-suites"],
  },
  {
    id: "T17.4",
    title: "No existe ninguna ruta heurística hacia policy deny",
    goals: ["G5"],
    requirements: ["R7", "R8", "R27.4"],
    tests: ["property/may-deny.property.test.js", "unit/pipeline.test.js", "integration/r27.test.js"],
    checks: ["candidate-fail-closed"],
  },
  {
    id: "T17.5",
    title: "Auditoría honesta, evidence freshness, waivers/N/A gobernados y rollback",
    goals: ["G4"],
    requirements: ["R12", "R13", "R18", "R19", "R20", "R21"],
    tests: ["integration/audit.test.js", "unit/audit-self-check.test.js", "unit/exceptions.test.js", "integration/exceptions.test.js", "unit/runtime.test.js"],
    checks: [],
  },
  {
    id: "T17.6",
    title: "Privacidad, supply chain, compatibilidad y documentación operativa",
    goals: ["G6", "G7"],
    requirements: ["R15", "R16", "R22", "R23", "R24", "R25", "R26", "R27.5", "R27.6"],
    tests: ["privacy/privacy.test.js", "unit/telemetry.test.js", "integration/plugins.test.js", "unit/adapters.test.js", "integration/surfaces.test.js", "unit/docs.test.js", "unit/test-hygiene.test.js"],
    checks: ["platform-matrix", "actions-pinned"],
  },
  {
    id: "T17.7",
    title: "Catálogo, versionado, changelog, migración, procedencia y evidencia de la suite completa",
    goals: ["G6"],
    requirements: ["R4", "R24", "R26"],
    tests: ["unit/release-gate.test.js"],
    checks: ["candidate-reproducible", "candidate-semver", "release-notes", "repo-suite", "test-coverage", "worktree-clean"],
  },
]);

/**
 * Jobs que la matriz declarada debe aportar (compatibility.js + workflow
 * kiritek-init-ci.yml). `suite: full` incluye engineering.
 */
const REQUIRED_JOBS = Object.freeze([
  { os: "linux", node: "22", suite: "full" },
  { os: "darwin", node: "22", suite: "full" },
  { os: "linux", node: "18", suite: "engineering" },
  { os: "linux", node: "20", suite: "engineering" },
  { os: "win32", node: "22", suite: "engineering" },
]);

module.exports = { CRITERIA, REQUIRED_JOBS };
