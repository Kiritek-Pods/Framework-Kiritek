"use strict";

/**
 * EngineeringEvidence (schema v2): respaldo reproducible y atribuible de una
 * conclusión engineering (R7). Sigue el patrón de `src/domain/evidence.js`
 * (clock/id inyectables) pero es un contrato propio: añade dominio, pack,
 * catálogo, unidad, scope y clase de evidencia. Nunca contiene código,
 * queries, payloads, prompts ni rutas absolutas (R7.7).
 */

const c = require("./common.js");
const { assertRevision } = require("./observation.js");

const SCHEMA_VERSION = 2;
const KEYS = [
  "schemaVersion",
  "id",
  "type",
  "evidenceClass",
  "confidence",
  "domain",
  "packId",
  "catalog",
  "control",
  "collectorVersions",
  "evaluatorVersion",
  "unitId",
  "revision",
  "scopeHash",
  "configHash",
  "platformKey",
  "createdAt",
  "expiresAt",
  "durationMs",
  "cache",
  "observationRefs",
  "reportRef",
  "manualReview",
  "redaction",
];

const defaultClock = () => new Date().toISOString();
let counter = 0;
const defaultIdGenerator = () => {
  counter += 1;
  return `eng-ev-${Date.now().toString(36)}-${counter.toString(36)}`;
};

function manualReview(input) {
  const label = "evidence.manualReview";
  c.assertObject(input, label);
  c.assertKnownKeys(input, ["reviewer", "scope", "checklistRef", "reviewedAt", "expiresAt", "reference"], label);
  c.assertString(input.reviewer, `${label}.reviewer`);
  c.assertString(input.scope, `${label}.scope`);
  c.assertRef(input.checklistRef, `${label}.checklistRef`);
  c.assertIso(input.reviewedAt, `${label}.reviewedAt`);
  c.assertIso(input.expiresAt, `${label}.expiresAt`);
  c.assertRef(input.reference, `${label}.reference`);
  if (Date.parse(input.expiresAt) <= Date.parse(input.reviewedAt)) c.fail(`${label}.expiresAt debe ser posterior a reviewedAt`);
  return { ...input };
}

function createEngineeringEvidence(input, deps = {}) {
  c.assertObject(input, "evidence");
  c.assertKnownKeys(input, KEYS, "evidence");
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`evidence.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }
  const clock = deps.clock || defaultClock;
  const idGenerator = deps.idGenerator || defaultIdGenerator;

  const id = input.id === undefined ? idGenerator() : input.id;
  c.assertRef(id, "evidence.id");
  c.assertRef(input.type, "evidence.type");
  c.assertEnum(input.evidenceClass, c.EVIDENCE_CLASSES, "evidence.evidenceClass");
  c.assertEnum(input.confidence, c.CONFIDENCES, "evidence.confidence");
  if (input.domain !== c.DOMAIN.ENGINEERING) c.fail(`evidence.domain debe ser "${c.DOMAIN.ENGINEERING}"`);
  if (input.packId !== c.PACK_ID) c.fail(`evidence.packId debe ser "${c.PACK_ID}"`);
  const catalog = c.createCatalogRef(input.catalog, "evidence.catalog");

  c.assertObject(input.control, "evidence.control");
  c.assertKnownKeys(input.control, ["id", "version", "contractVersion"], "evidence.control");
  c.assertControlId(input.control.id, "evidence.control.id");
  c.assertSemver(input.control.version, "evidence.control.version");
  c.assertSemver(input.control.contractVersion, "evidence.control.contractVersion");

  c.assertObject(input.collectorVersions, "evidence.collectorVersions");
  for (const [k, v] of Object.entries(input.collectorVersions)) {
    c.assertRef(k, "evidence.collectorVersions<key>");
    c.assertSemver(v, `evidence.collectorVersions.${k}`);
  }
  c.assertSemver(input.evaluatorVersion, "evidence.evaluatorVersion");
  c.assertNamespacedId(input.unitId, "evidence.unitId");
  assertRevision(input.revision, "evidence.revision");
  c.assertSha256(input.scopeHash, "evidence.scopeHash");
  c.assertSha256(input.configHash, "evidence.configHash");
  c.assertString(input.platformKey, "evidence.platformKey");

  const createdAt = input.createdAt === undefined ? clock() : input.createdAt;
  c.assertIso(createdAt, "evidence.createdAt");
  c.assertNonNegativeInt(input.durationMs, "evidence.durationMs");
  c.assertEnum(input.cache, c.CACHE_STATUSES, "evidence.cache");
  c.assertArray(input.observationRefs, "evidence.observationRefs");
  input.observationRefs.forEach((r, i) => c.assertRef(r, `evidence.observationRefs[${i}]`));

  c.assertObject(input.redaction, "evidence.redaction");
  c.assertKnownKeys(input.redaction, ["policyVersion", "verified"], "evidence.redaction");
  c.assertSemver(input.redaction.policyVersion, "evidence.redaction.policyVersion");
  if (input.redaction.verified !== true) {
    c.fail("evidence.redaction.verified debe ser true: sin redacción verificada no se persiste (R15)", "REDACTION_FAILED");
  }

  if (input.evidenceClass === c.EVIDENCE_CLASS.HEURISTIC && input.confidence === c.CONFIDENCE.DETERMINISTIC) {
    c.fail("evidencia heurística no puede declarar confianza determinista", "HEURISTIC_DETERMINISTIC");
  }
  const isManual = input.evidenceClass === c.EVIDENCE_CLASS.MANUAL;
  if (isManual && input.manualReview === undefined) c.fail("evidencia manual requiere manualReview (R7.6)");
  if (!isManual && input.manualReview !== undefined) c.fail("manualReview sólo aplica a evidencia manual: no se etiqueta como automatización");

  const ev = {
    schemaVersion: SCHEMA_VERSION,
    id,
    type: input.type,
    evidenceClass: input.evidenceClass,
    confidence: input.confidence,
    domain: input.domain,
    packId: input.packId,
    catalog,
    control: { id: input.control.id, version: input.control.version, contractVersion: input.control.contractVersion },
    collectorVersions: { ...input.collectorVersions },
    evaluatorVersion: input.evaluatorVersion,
    unitId: input.unitId,
    revision: input.revision,
    scopeHash: input.scopeHash,
    configHash: input.configHash,
    platformKey: input.platformKey,
    createdAt,
    durationMs: input.durationMs,
    cache: input.cache,
    observationRefs: [...input.observationRefs],
    redaction: { policyVersion: input.redaction.policyVersion, verified: true },
  };
  if (input.expiresAt !== undefined) {
    c.assertIso(input.expiresAt, "evidence.expiresAt");
    if (Date.parse(input.expiresAt) <= Date.parse(createdAt)) c.fail("evidence.expiresAt debe ser posterior a createdAt");
    ev.expiresAt = input.expiresAt;
  }
  if (input.reportRef !== undefined) {
    c.assertRef(input.reportRef, "evidence.reportRef");
    ev.reportRef = input.reportRef;
  }
  if (isManual) ev.manualReview = manualReview(input.manualReview);
  return c.deepFreeze(ev);
}

/**
 * Frescura de la evidencia respecto de la identidad actual (R7.3–R7.4).
 * Cualquier discrepancia de revisión/config/catálogo/unidad/scope/control la
 * deja `stale`: nunca sustenta verificación ni bloqueo actual.
 *
 * @returns {{ freshness: "fresh"|"stale"|"missing", reasons: string[] }}
 */
function evaluateFreshness(evidence, expected, deps = {}) {
  if (!evidence) return { freshness: c.FRESHNESS.MISSING, reasons: ["evidencia ausente"] };
  const now = deps.now ? deps.now() : Date.now();
  const reasons = [];
  const checks = [
    ["revision", evidence.revision, expected.revision],
    ["scopeHash", evidence.scopeHash, expected.scopeHash],
    ["configHash", evidence.configHash, expected.configHash],
    ["catalogDigest", evidence.catalog.digest, expected.catalogDigest],
    ["unitId", evidence.unitId, expected.unitId],
    ["controlId", evidence.control.id, expected.controlId],
    ["controlVersion", evidence.control.version, expected.controlVersion],
  ];
  for (const [name, actual, want] of checks) {
    if (want === undefined) reasons.push(`${name} esperado no provisto`);
    else if (actual !== want) reasons.push(`${name} no coincide`);
  }
  if (evidence.expiresAt !== undefined && Date.parse(evidence.expiresAt) <= now) reasons.push("evidencia expirada");
  if (expected.maxAgeSeconds !== undefined && now - Date.parse(evidence.createdAt) > expected.maxAgeSeconds * 1000) {
    reasons.push("evidencia supera la antigüedad máxima del control");
  }
  if (evidence.manualReview && Date.parse(evidence.manualReview.expiresAt) <= now) reasons.push("revisión manual expirada");
  return { freshness: reasons.length === 0 ? c.FRESHNESS.FRESH : c.FRESHNESS.STALE, reasons };
}

module.exports = { SCHEMA_VERSION, createEngineeringEvidence, evaluateFreshness };
