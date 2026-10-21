"use strict";

/**
 * EngineeringResultEnvelope (schema v2): contexto engineering alrededor de un
 * PolicyResult v1 sin romper `schemas/result.schema.json` (design §5.1).
 *
 * Invariantes:
 * - `state` distingue `off`, `not_evaluated`, `not_applicable`, `unknown`,
 *   `unavailable`, `timeout`, `conflict` y `stale` de `evaluated`. Ninguno de
 *   ellos admite `allow` ni `deny`: no equivalen a conformidad verificada.
 * - `blockingEligible` es derivado (design §9.2), nunca aportado por quien
 *   construye el envelope (evaluator/plugin).
 * - Un `deny` no elegible es inválido: el orquestador debe degradarlo antes
 *   (`DENY_NOT_ELIGIBLE`, T06.6); el contrato lo rechaza como red de seguridad.
 */

const c = require("./common.js");
const { createApplicability, APPLICABILITY_STATUS } = require("./applicability.js");
const { assertRevision } = require("./observation.js");
const { parsePolicyResultV1, DECISION, FINDING_STATUS } = require("./policy-result.js");

const SCHEMA_VERSION = 2;

/** Estado de evaluación del par unidad/control. */
const EVALUATION_STATE = Object.freeze({
  EVALUATED: "evaluated",
  OFF: "off",
  NOT_EVALUATED: "not_evaluated",
  NOT_APPLICABLE: "not_applicable",
  UNKNOWN: "unknown",
  UNAVAILABLE: "unavailable",
  TIMEOUT: "timeout",
  CONFLICT: "conflict",
  STALE: "stale",
});
const EVALUATION_STATES = Object.freeze(Object.values(EVALUATION_STATE));

/** Estados sin payload de decisión posible. */
const ABSTENTION_STATES = Object.freeze(["off", "not_evaluated", "not_applicable"]);
/** Estados operativos: payload ausente o `warn`/`error`, nunca allow/deny. */
const OPERATIONAL_STATES = Object.freeze(["unknown", "unavailable", "timeout", "conflict", "stale"]);

const EVIDENCE_CLASS_OR_NONE = Object.freeze([...c.EVIDENCE_CLASSES, "none"]);
const SUPPRESSION_KINDS = Object.freeze(["waiver", "governed-na"]);
/** Completitud del conjunto de evidencia: una parcial nunca sustenta deny. */
const COMPLETENESS = Object.freeze(["complete", "partial", "none"]);

const KEYS = [
  "schemaVersion",
  "domain",
  "packId",
  "catalog",
  "control",
  "unit",
  "profiles",
  "moment",
  "level",
  "state",
  "revision",
  "scopeHash",
  "configHash",
  "applicability",
  "confidence",
  "evidenceClass",
  "evidenceFreshness",
  "evidenceCompleteness",
  "evidence",
  "provenance",
  "result",
  "findingEvidence",
  "suppressed",
  "diagnostics",
  "durationMs",
  "cache",
  "blockingEligible",
];

function controlRef(input) {
  c.assertObject(input, "envelope.control");
  c.assertKnownKeys(input, ["id", "version", "contractVersion", "enforcementContractVersion", "enforcementMoments"], "envelope.control");
  c.assertControlId(input.id, "envelope.control.id");
  c.assertSemver(input.version, "envelope.control.version");
  c.assertSemver(input.contractVersion, "envelope.control.contractVersion");
  const out = { id: input.id, version: input.version, contractVersion: input.contractVersion };
  if (input.enforcementContractVersion !== undefined) {
    c.assertSemver(input.enforcementContractVersion, "envelope.control.enforcementContractVersion");
    out.enforcementContractVersion = input.enforcementContractVersion;
  }
  if (input.enforcementMoments !== undefined) {
    if (input.enforcementContractVersion === undefined) c.fail("envelope.control.enforcementMoments requiere enforcementContractVersion");
    c.assertArray(input.enforcementMoments, "envelope.control.enforcementMoments");
    if (input.enforcementMoments.length === 0) c.fail("envelope.control.enforcementMoments no puede estar vacío");
    input.enforcementMoments.forEach((m, i) => c.assertEnum(m, c.MOMENTS, `envelope.control.enforcementMoments[${i}]`));
    out.enforcementMoments = [...input.enforcementMoments];
  }
  return out;
}

function evidenceBinding(input) {
  const label = "envelope.evidence";
  c.assertObject(input, label);
  c.assertKnownKeys(input, ["id", "revision", "scopeHash", "configHash", "catalogDigest", "unitId", "controlId"], label);
  c.assertRef(input.id, `${label}.id`);
  assertRevision(input.revision, `${label}.revision`);
  c.assertSha256(input.scopeHash, `${label}.scopeHash`);
  c.assertSha256(input.configHash, `${label}.configHash`);
  c.assertSha256(input.catalogDigest, `${label}.catalogDigest`);
  c.assertNamespacedId(input.unitId, `${label}.unitId`);
  c.assertControlId(input.controlId, `${label}.controlId`);
  return { ...input };
}

function findingEvidenceEntry(input, i) {
  const label = `envelope.findingEvidence[${i}]`;
  c.assertObject(input, label);
  c.assertKnownKeys(input, ["fingerprint", "evidenceClass"], label);
  c.assertString(input.fingerprint, `${label}.fingerprint`);
  c.assertEnum(input.evidenceClass, c.EVIDENCE_CLASSES, `${label}.evidenceClass`);
  return { fingerprint: input.fingerprint, evidenceClass: input.evidenceClass };
}

function suppressionRef(input, i) {
  const label = `envelope.suppressed[${i}]`;
  c.assertObject(input, label);
  c.assertKnownKeys(input, ["kind", "ref", "expiresAt", "fingerprint"], label);
  c.assertEnum(input.kind, SUPPRESSION_KINDS, `${label}.kind`);
  c.assertRef(input.ref, `${label}.ref`);
  c.assertIso(input.expiresAt, `${label}.expiresAt`);
  const out = { kind: input.kind, ref: input.ref, expiresAt: input.expiresAt };
  if (input.fingerprint !== undefined) {
    c.assertString(input.fingerprint, `${label}.fingerprint`);
    out.fingerprint = input.fingerprint;
  } else if (input.kind === "waiver") {
    c.fail(`${label}: un waiver requiere fingerprint; no existen waivers globales`, "WAIVER_UNSCOPED");
  }
  return out;
}

/**
 * Findings que participan en un bloqueo (R8.4, T06.7): no suprimidos, no
 * resueltos, sin waiver y con evidencia determinista. Los heurísticos se
 * reportan en el mismo resultado pero nunca cuentan para bloquear.
 */
function blockingFindings(envelope) {
  if (!envelope.result) return [];
  const waived = new Set(envelope.suppressed.filter((s) => s.fingerprint).map((s) => s.fingerprint));
  const classes = new Map(envelope.findingEvidence.map((f) => [f.fingerprint, f.evidenceClass]));
  return envelope.result.findings.filter(
    (f) =>
      f.status !== FINDING_STATUS.SUPPRESSED &&
      f.status !== FINDING_STATUS.RESOLVED &&
      !waived.has(f.fingerprint) &&
      classes.get(f.fingerprint) === c.EVIDENCE_CLASS.DETERMINISTIC
  );
}

/**
 * Predicado único de bloqueo (design §9.2). Devuelve la lista de condiciones
 * incumplidas; vacía ⇔ el envelope puede sostener un `deny`.
 */
function denyEligibilityViolations(e) {
  const v = [];
  if (e.level !== c.LEVEL.ENFORCE) v.push("level != enforce");
  if (e.state !== EVALUATION_STATE.EVALUATED) v.push(`state ${e.state}`);
  if (!e.applicability || e.applicability.status !== APPLICABILITY_STATUS.APPLICABLE) v.push("aplicabilidad no confirmada");
  if (!e.applicability || e.applicability.confidence !== c.CONFIDENCE.DETERMINISTIC) v.push("aplicabilidad no determinista");
  if (e.evidenceClass !== c.EVIDENCE_CLASS.DETERMINISTIC) v.push(`evidencia ${e.evidenceClass}`);
  if (e.evidenceFreshness !== c.FRESHNESS.FRESH) v.push(`evidencia ${e.evidenceFreshness}`);
  const ev = e.evidence;
  if (!ev) {
    v.push("evidencia ausente");
  } else {
    if (ev.revision !== e.revision) v.push("revisión de evidencia distinta");
    if (ev.scopeHash !== e.scopeHash) v.push("scopeHash de evidencia distinto");
    if (ev.configHash !== e.configHash) v.push("configHash de evidencia distinto");
    if (ev.catalogDigest !== e.catalog.digest) v.push("catálogo de evidencia distinto");
    if (ev.unitId !== e.unit.id) v.push("unidad de evidencia distinta");
    if (ev.controlId !== e.control.id) v.push("control de evidencia distinto");
  }
  if (e.control.enforcementContractVersion === undefined) v.push("sin contrato de enforcement aprobado");
  else if (!e.control.enforcementMoments || !e.control.enforcementMoments.includes(e.moment)) {
    v.push(`momento ${e.moment} fuera del contrato de enforcement`);
  }
  if (e.evidenceCompleteness !== "complete") v.push("evidencia incompleta (parcial/timeout/inválida)");
  if (blockingFindings(e).length === 0) v.push("sin findings bloqueantes deterministas");
  if (e.applicability && e.applicability.scopeHash !== e.scopeHash) v.push("aplicabilidad de otro alcance");
  return v;
}

function mayDeny(envelope) {
  return denyEligibilityViolations(envelope).length === 0;
}

function build(input, { allowDerivedField }) {
  c.assertObject(input, "envelope");
  c.assertKnownKeys(input, KEYS, "envelope");
  if (!allowDerivedField && input.blockingEligible !== undefined) {
    c.fail("envelope.blockingEligible es derivado: no puede aportarse", "DERIVED_FIELD");
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`envelope.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }
  if (input.domain !== c.DOMAIN.ENGINEERING) c.fail(`envelope.domain debe ser "${c.DOMAIN.ENGINEERING}"`, "DOMAIN_MISMATCH");
  if (input.packId !== c.PACK_ID) c.fail(`envelope.packId debe ser "${c.PACK_ID}"`, "DOMAIN_MISMATCH");

  const catalog = c.createCatalogRef(input.catalog, "envelope.catalog");
  const control = controlRef(input.control);
  c.assertObject(input.unit, "envelope.unit");
  c.assertKnownKeys(input.unit, ["id", "rootHash"], "envelope.unit");
  c.assertNamespacedId(input.unit.id, "envelope.unit.id");
  c.assertSha256(input.unit.rootHash, "envelope.unit.rootHash");
  c.assertArray(input.profiles, "envelope.profiles");
  const profiles = input.profiles.map((p, i) => c.createProfileRef(p, `envelope.profiles[${i}]`));
  c.assertEnum(input.moment, c.MOMENTS, "envelope.moment");
  c.assertEnum(input.level, c.LEVELS, "envelope.level");
  c.assertEnum(input.state, EVALUATION_STATES, "envelope.state");
  assertRevision(input.revision, "envelope.revision");
  c.assertSha256(input.scopeHash, "envelope.scopeHash");
  c.assertSha256(input.configHash, "envelope.configHash");

  const applicability = input.applicability === null ? null : createApplicability(input.applicability);
  if (applicability && (applicability.unitId !== input.unit.id || applicability.controlId !== control.id)) {
    c.fail("envelope.applicability pertenece a otra unidad/control", "IDENTITY_MISMATCH");
  }
  c.assertEnum(input.confidence, c.CONFIDENCES, "envelope.confidence");
  c.assertEnum(input.evidenceClass, EVIDENCE_CLASS_OR_NONE, "envelope.evidenceClass");
  c.assertEnum(input.evidenceFreshness, c.FRESHNESSES, "envelope.evidenceFreshness");
  c.assertEnum(input.evidenceCompleteness, COMPLETENESS, "envelope.evidenceCompleteness");
  const evidence = input.evidence === null ? null : evidenceBinding(input.evidence);

  c.assertObject(input.provenance, "envelope.provenance");
  c.assertKnownKeys(input.provenance, ["level", "profiles"], "envelope.provenance");
  const provenance = { level: c.createProvenance(input.provenance.level, "envelope.provenance.level") };
  if (input.provenance.profiles !== undefined) {
    provenance.profiles = c.createProvenance(input.provenance.profiles, "envelope.provenance.profiles");
  }

  const result = input.result === null ? null : parsePolicyResultV1(input.result);
  c.assertArray(input.findingEvidence, "envelope.findingEvidence");
  const findingEvidence = input.findingEvidence.map(findingEvidenceEntry);
  c.assertUnique(findingEvidence, (f) => f.fingerprint, "envelope.findingEvidence");
  c.assertArray(input.suppressed, "envelope.suppressed");
  const suppressed = input.suppressed.map(suppressionRef);
  c.assertArray(input.diagnostics, "envelope.diagnostics");
  const diagnostics = input.diagnostics.map((d, i) => c.createDiagnostic(d, `envelope.diagnostics[${i}]`));
  c.assertNonNegativeInt(input.durationMs, "envelope.durationMs");
  c.assertEnum(input.cache, c.CACHE_STATUSES, "envelope.cache");

  // --- Consistencia estado/nivel/payload -------------------------------
  const state = input.state;
  if ((input.level === c.LEVEL.OFF) !== (state === EVALUATION_STATE.OFF)) {
    c.fail("envelope: level 'off' ⇔ state 'off' (R3.4)", "STATE_INCONSISTENT");
  }
  if (result && result.controlId !== control.id) c.fail("envelope.result.controlId no coincide con control.id", "IDENTITY_MISMATCH");
  if (ABSTENTION_STATES.includes(state) && result !== null) {
    c.fail(`envelope state '${state}' no admite payload de decisión: no equivale a allow`, "STATE_INCONSISTENT");
  }
  if (OPERATIONAL_STATES.includes(state) && result && ![DECISION.WARN, DECISION.ERROR].includes(result.decision)) {
    c.fail(`envelope state '${state}' sólo admite warn/error, nunca ${result.decision}`, "STATE_INCONSISTENT");
  }
  if (state !== EVALUATION_STATE.EVALUATED && state !== EVALUATION_STATE.OFF && state !== EVALUATION_STATE.NOT_EVALUATED && diagnostics.length === 0) {
    c.fail(`envelope state '${state}' requiere diagnóstico con la causa`, "STATE_INCONSISTENT");
  }
  if (state === EVALUATION_STATE.EVALUATED) {
    if (!result) c.fail("envelope 'evaluated' requiere result", "STATE_INCONSISTENT");
    if (!applicability || applicability.status !== APPLICABILITY_STATUS.APPLICABLE || applicability.confidence === c.CONFIDENCE.UNKNOWN) {
      c.fail("envelope 'evaluated' requiere aplicabilidad confirmada (R5.1)", "STATE_INCONSISTENT");
    }
  }
  if (state === EVALUATION_STATE.NOT_APPLICABLE && (!applicability || applicability.status !== APPLICABILITY_STATUS.NOT_APPLICABLE)) {
    c.fail("envelope 'not_applicable' requiere applicability not_applicable", "STATE_INCONSISTENT");
  }
  if (state === EVALUATION_STATE.UNKNOWN && applicability && applicability.status === APPLICABILITY_STATUS.APPLICABLE && applicability.confidence !== c.CONFIDENCE.UNKNOWN) {
    c.fail("envelope 'unknown' contradice una aplicabilidad confirmada", "STATE_INCONSISTENT");
  }
  if (state === EVALUATION_STATE.STALE && input.evidenceFreshness !== c.FRESHNESS.STALE) {
    c.fail("envelope 'stale' requiere evidenceFreshness 'stale'", "STATE_INCONSISTENT");
  }
  if (state === EVALUATION_STATE.CONFLICT && input.evidenceFreshness !== c.FRESHNESS.CONFLICT) {
    c.fail("envelope 'conflict' requiere evidenceFreshness 'conflict'", "STATE_INCONSISTENT");
  }
  if ((evidence === null) !== (input.evidenceCompleteness === "none")) {
    c.fail("envelope: evidencia ausente ⇔ evidenceCompleteness 'none'", "STATE_INCONSISTENT");
  }
  if ((evidence === null) !== (input.evidenceFreshness === c.FRESHNESS.MISSING)) {
    c.fail("envelope: evidencia ausente ⇔ evidenceFreshness 'missing'", "STATE_INCONSISTENT");
  }
  if (input.evidenceClass === "none" && evidence !== null) c.fail("envelope: evidenceClass 'none' no admite evidencia");
  if (input.evidenceClass === c.EVIDENCE_CLASS.HEURISTIC && input.confidence === c.CONFIDENCE.DETERMINISTIC) {
    c.fail("envelope: heurística no puede declarar confianza determinista", "HEURISTIC_DETERMINISTIC");
  }

  // Cada finding del payload debe declarar su clase de evidencia (R7.1, R8.4).
  const resultFingerprints = new Set(result ? result.findings.map((f) => f.fingerprint) : []);
  for (const f of resultFingerprints) {
    if (!findingEvidence.some((fe) => fe.fingerprint === f)) c.fail(`envelope: finding ${f} sin clase de evidencia`);
  }
  for (const fe of findingEvidence) {
    if (!resultFingerprints.has(fe.fingerprint)) c.fail(`envelope.findingEvidence referencia finding inexistente ${fe.fingerprint}`);
  }
  for (const s of suppressed) {
    if (s.fingerprint !== undefined && !resultFingerprints.has(s.fingerprint)) {
      c.fail(`envelope.suppressed referencia finding inexistente ${s.fingerprint}`);
    }
  }
  if (result) {
    for (const f of result.findings) {
      if (f.status === FINDING_STATUS.SUPPRESSED && !suppressed.some((s) => s.fingerprint === f.fingerprint)) {
        c.fail(`envelope: finding ${f.fingerprint} suprimido sin referencia a waiver/N-A (deuda trazable)`);
      }
    }
    // Supresión conserva deuda: nunca se presenta como allow limpio (R18).
    if (suppressed.length > 0 && result.decision === DECISION.ALLOW) {
      c.fail("envelope: un resultado con supresiones no puede ser allow limpio", "SUPPRESSION_AS_ALLOW");
    }
  }

  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    domain: c.DOMAIN.ENGINEERING,
    packId: c.PACK_ID,
    catalog,
    control,
    unit: { id: input.unit.id, rootHash: input.unit.rootHash },
    profiles,
    moment: input.moment,
    level: input.level,
    state,
    revision: input.revision,
    scopeHash: input.scopeHash,
    configHash: input.configHash,
    applicability,
    confidence: input.confidence,
    evidenceClass: input.evidenceClass,
    evidenceFreshness: input.evidenceFreshness,
    evidenceCompleteness: input.evidenceCompleteness,
    evidence,
    provenance,
    result,
    findingEvidence,
    suppressed,
    diagnostics,
    durationMs: input.durationMs,
    cache: input.cache,
  };

  const violations = denyEligibilityViolations(envelope);
  envelope.blockingEligible = violations.length === 0;

  if (result && result.decision === DECISION.DENY && !envelope.blockingEligible) {
    const err = new c.ContractError(
      `DENY_NOT_ELIGIBLE: deny sin condiciones de bloqueo (${violations.join("; ")})`,
      "DENY_NOT_ELIGIBLE"
    );
    err.violations = violations;
    throw err;
  }
  if (allowDerivedField && input.blockingEligible !== undefined && input.blockingEligible !== envelope.blockingEligible) {
    c.fail("envelope.blockingEligible no coincide con el predicado recalculado", "DERIVED_FIELD");
  }
  return c.deepFreeze(envelope);
}

/** Construye un envelope nuevo. Rechaza `blockingEligible` aportado. */
function createResultEnvelope(input) {
  return build(input, { allowDerivedField: false });
}

/**
 * Lee un envelope serializado (round-trip): valida el schema JSON y
 * recalcula `blockingEligible`, rechazando discrepancias.
 */
function parseResultEnvelope(value) {
  const { validateAgainst } = require("../../../domain/schema-validator.js");
  const check = validateAgainst("engineering/result-envelope", value, { extended: true });
  if (!check.valid) c.fail(`envelope inválido: ${check.errors.join("; ")}`, "ENVELOPE_SCHEMA");
  return build(value, { allowDerivedField: true });
}

/**
 * ¿El envelope prueba conformidad verificada de su control? Sólo un `allow`
 * evaluado, aplicable, con evidencia determinista fresca. Abstenciones,
 * estados operativos y heurísticas nunca lo hacen.
 */
function isVerifiedConformity(envelope) {
  return (
    envelope.state === EVALUATION_STATE.EVALUATED &&
    !!envelope.result &&
    envelope.result.decision === DECISION.ALLOW &&
    envelope.applicability.status === APPLICABILITY_STATUS.APPLICABLE &&
    envelope.evidenceClass === c.EVIDENCE_CLASS.DETERMINISTIC &&
    envelope.evidenceFreshness === c.FRESHNESS.FRESH &&
    envelope.suppressed.length === 0
  );
}

module.exports = {
  SCHEMA_VERSION,
  EVALUATION_STATE,
  EVALUATION_STATES,
  ABSTENTION_STATES,
  OPERATIONAL_STATES,
  COMPLETENESS,
  createResultEnvelope,
  parseResultEnvelope,
  denyEligibilityViolations,
  mayDeny,
  blockingFindings,
  isVerifiedConformity,
};
