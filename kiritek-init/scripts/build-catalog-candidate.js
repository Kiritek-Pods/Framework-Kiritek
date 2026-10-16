#!/usr/bin/env node
"use strict";

/**
 * Construye el candidato de catálogo 2.0.0 (T17.7) a partir del 1.0.0
 * publicado: los tres controles iniciales, los veinte nuevos (T18–T37) con
 * sus perfiles y schemas de parámetros, `enforce` soportado y
 * `enforcementContract` ligado a la suite R27 de cada control.
 * Reproducible: mismo input, mismo digest. Las notas (`notes/`) se
 * mantienen a mano en el candidato.
 *
 *   node scripts/build-catalog-candidate.js [--check]
 *
 * `--check` no escribe: falla (exit 1) si el candidato en disco difiere.
 */

const fs = require("node:fs");
const path = require("node:path");
const { readCatalogDir } = require("../src/engineering/guardrails/catalog/load.js");
const { computeCatalogDigest } = require("../src/engineering/guardrails/catalog/verify.js");
const { SUITES } = require("../src/engineering/guardrails/conformance/registry.js");

const ROOT = path.join(__dirname, "..");
const BASE = path.join(ROOT, "catalogs", "engineering", "guardrails", "1.0.0");
const CANDIDATE = path.join(ROOT, "release", "candidates", "engineering", "guardrails", "2.0.0");
const VERSION = "2.0.0";
const PUBLISHED_AT = "2026-10-13T00:00:00Z";
const MIGRATION_REF = "notes/MIGRATION-1.0.0-to-2.0.0.md";

const REPO_PATH = "^(?![/~])(?![A-Za-z]:)(?!(?:.*/)?\\.\\.(?:/|$))[^\\u0000\\\\]+$";
const EVIDENCE_AGE = { type: "integer", minimum: 1, maximum: 720 };

/** Perfiles nuevos del catálogo 2.0.0 (explícitos: nada se activa solo). */
const NEW_PROFILES = [
  { id: "data-views", version: "1.0.0", description: "Pantallas o vistas que cargan datos remotos.", extends: [] },
  { id: "forms", version: "1.0.0", description: "Formularios que capturan datos del usuario.", extends: [] },
  { id: "network-client", version: "1.0.0", description: "Cliente que llama APIs remotas (web, móvil o servicio).", extends: [] },
  { id: "feature-flags", version: "1.0.0", description: "Usa feature flags para liberar o apagar funcionalidades.", extends: [] },
  { id: "auth-session", version: "1.0.0", description: "Maneja sesiones de usuario que pueden expirar.", extends: [] },
  { id: "file-upload", version: "1.0.0", description: "Permite subir archivos.", extends: [] },
  { id: "paginated-lists", version: "1.0.0", description: "Muestra listas largas cargadas por páginas.", extends: [] },
  { id: "analytics", version: "1.0.0", description: "Envía eventos de analytics.", extends: [] },
  { id: "destructive-actions", version: "1.0.0", description: "Tiene acciones que borran, cancelan o cobran.", extends: [] },
  { id: "localized", version: "1.0.0", description: "Se muestra en más de un idioma o país.", extends: [] },
  { id: "offline-capable", version: "1.0.0", description: "Debe seguir funcionando sin conexión.", extends: [] },
  { id: "device-permissions", version: "1.0.0", description: "Pide permisos del dispositivo (cámara, ubicación, notificaciones…).", extends: [] },
  { id: "routed-app", version: "1.0.0", description: "Tiene rutas o enlaces profundos.", extends: [] },
  { id: "dialogs", version: "1.0.0", description: "Usa modales, menús o paneles laterales.", extends: [] },
  { id: "http-api", version: "1.0.0", description: "Expone una API HTTP.", extends: [] },
  { id: "backend-service", version: "1.0.0", description: "Servicio de backend con dependencias y ciclo de vida propio.", extends: [] },
];

/** Controles nuevos (T18–T21): id, carpeta, perfil, parámetros y defaults. */
const NEW_CONTROLS = [
  {
    id: "ui.data-states",
    slug: "ui-data-states",
    profile: "data-views",
    properties: { statesContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxTimeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxTimeoutMs: 30000, maxEvidenceAgeHours: 24 },
  },
  {
    id: "ui.form-validation",
    slug: "ui-form-validation",
    profile: "forms",
    properties: { formsContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxEvidenceAgeHours: 24 },
  },
  {
    id: "net.resilient-requests",
    slug: "net-resilient-requests",
    profile: "network-client",
    properties: { clientContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxTimeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }, maxAttempts: { type: "integer", minimum: 1, maximum: 10 }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxTimeoutMs: 30000, maxAttempts: 5, maxEvidenceAgeHours: 24 },
  },
  {
    id: "flags.lifecycle",
    slug: "flags-lifecycle",
    profile: "feature-flags",
    properties: { flagRegistry: { type: "string", minLength: 1, pattern: REPO_PATH }, maxLifetimeDays: { type: "integer", minimum: 1, maximum: 730 }, expiryWarningDays: { type: "integer", minimum: 0, maximum: 90 }, maxClientTimeoutMs: { type: "integer", minimum: 50, maximum: 30000 }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxLifetimeDays: 90, expiryWarningDays: 14, maxClientTimeoutMs: 5000, maxEvidenceAgeHours: 24 },
  },
  {
    id: "auth.session-expiry",
    slug: "auth-session-expiry",
    profile: "auth-session",
    properties: { sessionContract: { type: "string", minLength: 1, pattern: REPO_PATH }, requireRefresh: { type: "boolean" }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { requireRefresh: false, maxEvidenceAgeHours: 24 },
  },
  {
    id: "ui.file-upload",
    slug: "ui-file-upload",
    profile: "file-upload",
    properties: { uploadsContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxBytesLimit: { type: "integer", minimum: 1, maximum: 10737418240 }, allowAnyType: { type: "boolean" }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxBytesLimit: 104857600, allowAnyType: false, maxEvidenceAgeHours: 24 },
  },
  {
    id: "ui.pagination",
    slug: "ui-pagination",
    profile: "paginated-lists",
    properties: { listsContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxPageSize: { type: "integer", minimum: 1, maximum: 500 }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxPageSize: 200, maxEvidenceAgeHours: 24 },
  },
  {
    id: "analytics.events",
    slug: "analytics-events",
    profile: "analytics",
    properties: { trackingPlan: { type: "string", minLength: 1, pattern: REPO_PATH }, forbiddenProperties: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", pattern: "^[a-z][a-z0-9_]*$" } }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { forbiddenProperties: ["email", "phone", "address", "password", "token", "ssn", "ip", "full_name", "first_name", "last_name", "birth"], maxEvidenceAgeHours: 24 },
  },
  {
    id: "ui.destructive-actions",
    slug: "ui-destructive-actions",
    profile: "destructive-actions",
    properties: { actionsContract: { type: "string", minLength: 1, pattern: REPO_PATH }, minUndoWindowMs: { type: "integer", minimum: 0, maximum: 600000 }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { minUndoWindowMs: 3000, maxEvidenceAgeHours: 24 },
  },
  {
    id: "i18n.formatting",
    slug: "i18n-formatting",
    profile: "localized",
    properties: { i18nContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxEvidenceAgeHours: 24 },
  },
  {
    id: "app.offline-mode",
    slug: "app-offline-mode",
    profile: "offline-capable",
    properties: { offlineContract: { type: "string", minLength: 1, pattern: REPO_PATH }, maxEvidenceAgeHours: EVIDENCE_AGE },
    defaults: { maxEvidenceAgeHours: 24 },
  },
  ...[
    ["app.device-permissions", "app-device-permissions", "device-permissions", "permissionsContract"],
    ["nav.broken-routes", "nav-broken-routes", "routed-app", "routesContract"],
    ["ui.accessible-dialogs", "ui-accessible-dialogs", "dialogs", "dialogsContract"],
  ].map(([id, slug, profile, param]) => ({ id, slug, profile, properties: { [param]: { type: "string", minLength: 1, pattern: REPO_PATH }, maxEvidenceAgeHours: EVIDENCE_AGE }, defaults: { maxEvidenceAgeHours: 24 } })),
  // Backend (T32–T37).
  ...[
    ["api.idempotency", "api-idempotency", "http-api", "idempotencyContract", {}, {}],
    ["api.error-responses", "api-error-responses", "http-api", "errorsContract", {}, {}],
    ["api.rate-limit", "api-rate-limit", "http-api", "rateLimitContract", {}, {}],
    ["api.pagination", "api-pagination", "http-api", "paginationContract", { maxPageSizeLimit: { type: "integer", minimum: 1, maximum: 1000 } }, { maxPageSizeLimit: 500 }],
    ["svc.dependency-failure", "svc-dependency-failure", "backend-service", "dependencyContract", { maxTimeoutMs: { type: "integer", minimum: 10, maximum: 120000 } }, { maxTimeoutMs: 10000 }],
    ["svc.health-shutdown", "svc-health-shutdown", "backend-service", "healthContract", { maxGraceMs: { type: "integer", minimum: 100, maximum: 600000 } }, { maxGraceMs: 30000 }],
  ].map(([id, slug, profile, param, props, defs]) => ({ id, slug, profile, properties: { [param]: { type: "string", minLength: 1, pattern: REPO_PATH }, ...props, maxEvidenceAgeHours: EVIDENCE_AGE }, defaults: { ...defs, maxEvidenceAgeHours: 24 } })),
];

function newControl(template, c) {
  return {
    ...JSON.parse(JSON.stringify(template)),
    id: c.id,
    version: "1.0.0",
    contractVersion: "1.0.0",
    profiles: { allOf: [c.profile] },
    parametersSchemaRef: `parameters/${c.id}.schema.json`,
    defaults: { level: "warn", parameters: { ...c.defaults } },
    collectors: [`${c.slug}/collector`],
    normalizer: `${c.slug}/normalizer`,
    applicability: `${c.slug}/applicability`,
    evaluator: `${c.slug}/evaluator`,
    documentationRef: `docs/engineering/controls/${c.slug}.md`,
  };
}

function paramsSchema(c) {
  return { $schema: "http://json-schema.org/draft-07/schema#", title: `Parámetros de ${c.id}`, type: "object", additionalProperties: false, properties: c.properties };
}

function buildCandidate() {
  const base = readCatalogDir(BASE);
  const current = readCatalogDir(CANDIDATE);
  const files = { ...base };
  // Notas propias del candidato (changelog, migración); parámetros desde la base.
  for (const [rel, buf] of Object.entries(current)) if (rel.startsWith("notes/")) files[rel] = buf;
  const doc = JSON.parse(base["catalog.json"].toString("utf8"));
  doc.version = VERSION;
  doc.publishedAt = PUBLISHED_AT;
  doc.migrations = [{ from: "1.0.0", to: VERSION, ref: MIGRATION_REF }];
  doc.profiles = [...doc.profiles, ...NEW_PROFILES];
  const template = doc.controls.find((c) => c.id === "search.input-rate");
  for (const c of NEW_CONTROLS) {
    doc.controls.push(newControl(template, c));
    files[`parameters/${c.id}.schema.json`] = Buffer.from(`${JSON.stringify(paramsSchema(c), null, 2)}\n`);
  }
  for (const ctl of doc.controls) {
    const suite = SUITES[ctl.id];
    if (!suite) throw new Error(`control sin suite R27: ${ctl.id}`);
    ctl.supportedLevels = ["off", "warn", "enforce"];
    ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: suite.id, approvedVersion: suite.version, moments: ["pr", "release"] };
  }
  doc.digest = computeCatalogDigest(doc, files);
  files["catalog.json"] = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`);
  return { doc, files };
}

if (require.main === module) {
  const { doc, files } = buildCandidate();
  if (process.argv.includes("--check")) {
    const disk = readCatalogDir(CANDIDATE);
    const same = Object.keys(files).length === Object.keys(disk).length && Object.entries(files).every(([rel, buf]) => disk[rel] && disk[rel].equals(buf));
    process.stdout.write(`${same ? "ok" : "DIFIERE"} ${doc.version} ${doc.digest}\n`);
    process.exit(same ? 0 : 1);
  }
  for (const [rel, buf] of Object.entries(files)) {
    const target = path.join(CANDIDATE, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }
  process.stdout.write(`${doc.version} ${doc.digest}\n`);
}

module.exports = { buildCandidate, CANDIDATE, VERSION, NEW_CONTROLS, NEW_PROFILES };
