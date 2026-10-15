"use strict";

/**
 * Validación de gobierno de waivers y N/A (T13.1–T13.3). Pura salvo
 * `fileExists` inyectado (prueba de no aplicabilidad).
 *
 * - Waiver: deuda conocida y temporal sobre un finding (fingerprint) o una
 *   condición exacta (ruleId del control), con alcance verificable.
 * - N/A gobernado: no aplicabilidad funcional con prueba (`evidenceRef`) y
 *   fecha de revisión; no finge un finding.
 *
 * Rechazos: comodines globales o alcance fuera de la unidad, unidad/control
 * desconocidos, autoaprobación, aprobación faltante según criticidad,
 * expiraciones invertidas o excesivas, creación futura y prueba ausente.
 * Lo vencido NO es inválido: sigue cargado y el pipeline lo reactiva.
 */

const { validateAgainst } = require("../../../domain/schema-validator.js");
const { hasGlobChars } = require("../workspace/glob.js");

const DAY_MS = 86400000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SCHEMAS = { waiver: "engineering/waiver", "governed-na": "engineering/governed-na" };
const GLOBAL_GLOBS = new Set(["*", "**", "**/*", "./**", "."]);

/** ¿El glob queda dentro de la raíz de la unidad y no es global? */
function scopedToUnit(glob, unitRoot) {
  if (GLOBAL_GLOBS.has(glob)) return false;
  if (unitRoot === ".") return !hasGlobChars(glob.split("/")[0]);
  return glob === unitRoot || glob.startsWith(`${unitRoot}/`);
}

/** Forma interna mínima que consume el pipeline (sin razón/owner/ticket). */
function normalize(doc) {
  const out = { id: doc.id, kind: doc.kind, unitId: doc.unitId, controlId: doc.controlId, expiresAt: doc.kind === "waiver" ? doc.expiresAt : doc.reviewAt };
  if (doc.controlVersion) out.controlVersion = doc.controlVersion;
  if (doc.target && doc.target.fingerprint) out.fingerprint = doc.target.fingerprint;
  if (doc.target && doc.target.ruleId) out.ruleId = doc.target.ruleId;
  if (doc.scope.paths) out.paths = [...doc.scope.paths];
  if (doc.scope.scopeHash) out.scopeHash = doc.scope.scopeHash;
  return out;
}

/**
 * @param {object} doc
 * @param {object} ctx  { nowIso, policy, units: Map<id,{root}>, controls: Map<id,{version}>, fileExists?(rel) }
 * @returns {{status: "valid"|"expired"|"invalid", errors: string[], record?}}
 */
function validateException(doc, ctx) {
  const kind = doc && typeof doc === "object" ? doc.kind : undefined;
  if (!SCHEMAS[kind]) return { status: "invalid", errors: ["KIND_UNKNOWN"] };
  if (!validateAgainst(SCHEMAS[kind], doc, { extended: true }).valid) return { status: "invalid", errors: ["SCHEMA_INVALID"] };

  const errors = [];
  const policy = ctx.policy || {};
  const unit = ctx.units.get(doc.unitId);
  if (!unit) errors.push("UNKNOWN_UNIT");
  if (!ctx.controls.has(doc.controlId)) errors.push("UNKNOWN_CONTROL");
  if (doc.target && doc.target.ruleId && !doc.target.ruleId.startsWith(`${doc.controlId}/`)) errors.push("RULE_OUTSIDE_CONTROL");
  if (unit && doc.scope.paths && !doc.scope.paths.every((g) => scopedToUnit(g, unit.root))) errors.push("GLOBAL_SCOPE");

  if (doc.approver && policy.requireDistinctApprover !== false && doc.approver === doc.owner) errors.push("SELF_APPROVAL");
  if (kind === "governed-na" && !doc.approver && (policy.naApproval === "always" || doc.criticality === "high")) errors.push("APPROVER_REQUIRED");

  const now = Date.parse(ctx.nowIso);
  const created = Date.parse(doc.createdAt);
  const until = Date.parse(kind === "waiver" ? doc.expiresAt : doc.reviewAt);
  const maxDays = kind === "waiver" ? policy.maxWaiverDays || 90 : policy.maxNaReviewDays || 365;
  if (created > now + CLOCK_SKEW_MS) errors.push("CREATED_IN_FUTURE");
  if (until <= created) errors.push("EXPIRY_NOT_AFTER_CREATION");
  else if (until - created > maxDays * DAY_MS) errors.push("EXPIRY_EXCESSIVE");

  if (kind === "governed-na" && ctx.fileExists && !ctx.fileExists(doc.evidenceRef)) errors.push("NA_EVIDENCE_MISSING");

  if (errors.length) return { status: "invalid", errors };
  return { status: until <= now ? "expired" : "valid", errors: [], record: normalize(doc) };
}

module.exports = { validateException, normalize, scopedToUnit };
