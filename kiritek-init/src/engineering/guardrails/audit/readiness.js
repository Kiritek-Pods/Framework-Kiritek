"use strict";

/**
 * Readiness para promover un control de una unidad (T15.4, R21.2–R21.6).
 *
 * Verifica, por unidad/control y SÓLO para ese par (nunca promueve otros):
 * catálogo, config, soporte de enforce, contrato de enforcement con suite
 * R27 aprobada, aplicabilidad, linkage, self-checks, superficies (adapters,
 * CI/release), evidencia determinista fresca y completa en cada momento de
 * enforcement, presupuestos, excepciones inválidas, calidad (falsos
 * positivos / errores), documentación y ownership. El tiempo transcurrido no
 * cuenta como criterio. Volver a `warn` siempre está permitido.
 */

const fs = require("node:fs");
const path = require("node:path");
const { profileRequirement } = require("../workspace/units.js");
const { checkLinkage } = require("./capabilities.js");

const CONTROLS_DIR = path.join(__dirname, "..", "controls");
const PACKAGE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const DEFAULT_THRESHOLDS = Object.freeze({ falsePositiveRate: 0.05, errorRate: 0.05, minJudged: 5 });

/**
 * @param {object} input
 * @param {string} input.unitId
 * @param {string} input.controlId
 * @param {object} input.resolvedConfig
 * @param {object} input.catalogSnapshot
 * @param {object} input.resolvedUnits
 * @param {Record<string, object>} input.controls
 * @param {object} input.audit           Salida de runEngineeringAudit.
 * @param {Record<string, object>} input.ledgers  readRunLedgers().ledgers
 * @param {{passed, checks}} input.selfCheck
 * @param {{rejected: object[]}} [input.exceptions]
 * @param {Record<string, object>} [input.quality]  qualityByControl()
 * @param {string} [input.repoRoot]
 * @param {object} [input.thresholds]
 * @param {{ref, passed, cases}} [input.conformance]  Resultado de runConformance (suite R27).
 * @returns {{unitId, controlId, ready: boolean, blockers: string[], checks: object[]}}
 */
function assessReadiness(input) {
  const { unitId, controlId, resolvedConfig, catalogSnapshot: snap, resolvedUnits, controls, audit, ledgers } = input;
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) };
  const checks = [];
  const add = (id, passed, detail, severity = "blocker") => checks.push({ id, passed: !!passed, severity, detail });
  const control = snap.catalog.controls.find((c) => c.id === controlId);
  const unit = resolvedUnits.units.find((u) => u.id === unitId);
  add("catalog", true, `${snap.ref.version} ${snap.ref.digest.slice(0, 19)}… verificado`);
  add("config", true, `configHash ${resolvedConfig.configHash.slice(0, 19)}…`);
  if (!control || !unit) {
    add("selector", false, !control ? `control desconocido ${controlId}` : `unidad desconocida ${unitId}`);
    return finish(unitId, controlId, checks);
  }
  const ec = control.enforcementContract;
  add("enforce-supported", (control.supportedLevels || []).includes("enforce"), `niveles del catálogo: ${(control.supportedLevels || []).join(", ")}`);
  add("enforcement-contract", !!ec, ec ? `contrato ${ec.conformanceSuite}@${ec.approvedVersion}; momentos ${ec.moments.join(", ")}` : "sin contrato de enforcement ni suite R27 aprobada");
  // Suite R27: la del contrato debe ser la registrada del control y pasar AHORA.
  const conf = input.conformance;
  const declared = ec ? `${ec.conformanceSuite}@${ec.approvedVersion}` : null;
  if (!conf || !conf.ref) add("conformance-suite", false, "el control no tiene suite de conformidad R27 registrada");
  else if (declared !== conf.ref) add("conformance-suite", false, `el contrato declara ${declared || "—"} pero la suite del control es ${conf.ref}`);
  else add("conformance-suite", conf.passed, conf.passed ? `${conf.ref}: ${conf.cases.length} casos (positivos/negativos/borde) en verde y reproducibles` : `${conf.ref} falla: ${conf.cases.filter((c) => !c.passed).map((c) => c.id).join(", ")}`);
  add("integrity", audit.pack.integrity !== "failed", `integridad del pack ${audit.pack.integrity}`);
  const req = profileRequirement(unit, control);
  add("applicability", req.satisfied, req.satisfied ? "perfiles explícitos presentes" : `faltan perfiles: ${req.missing.map((p) => p.id).join(", ")}`);
  const linkage = checkLinkage(control, controls[controlId]);
  add("linkage", linkage === "verified", `implementación ${linkage}`);
  const sc = (input.selfCheck ? input.selfCheck.checks : []).filter((c) => c.controlId === controlId || !c.controlId);
  add("self-check", sc.length > 0 && sc.every((c) => c.passed), sc.length ? sc.map((c) => `${c.id}:${c.passed ? "ok" : "fail"}`).join(", ") : "self-checks no ejecutados");

  const moments = ec ? ec.moments : [];
  for (const moment of moments) {
    const row = audit.capabilities.find((r) => r.unitId === unitId && r.controlId === controlId && r.moment === moment);
    const last = ledgers[moment] ? ledgers[moment].results.find((r) => r.unitId === unitId && r.controlId === controlId) : null;
    if (moment === "pr") add("surface:pr", !["missing", "drift"].includes(audit.surfaces.ci.status), `CI ${audit.surfaces.ci.status}`);
    else if (moment === "agent" || moment === "pre-commit") add(`surface:${moment}`, row && row.momentCovered === "verified", `superficie ${row ? row.momentCovered : "desconocida"}`);
    add(`evidence:${moment}`, row && row.status === "verified" && last && last.evidenceClass === "deterministic" && last.evidenceCompleteness === "complete", row ? `${row.status}${row.reason ? ` — ${row.reason}` : ""}` : "sin fila de auditoría");
    const budget = (control.moments.find((m) => m.moment === moment) || {}).budgetMs;
    add(`budget:${moment}`, !!last && last.durationMs <= budget, last ? `${last.durationMs}ms / ${budget}ms` : "sin ejecución medida");
  }
  if (!moments.length) add("evidence", false, "sin momentos de enforcement declarados");

  const rejected = ((input.exceptions && input.exceptions.rejected) || []).filter((r) => r.unitId === unitId && r.controlId === controlId);
  add("exceptions", rejected.length === 0, rejected.length ? `${rejected.length} waiver/N-A inválido(s): ${rejected.map((r) => r.ref || r.file).join(", ")}` : "sin excepciones inválidas");

  const q = (input.quality || {})[controlId];
  const judged = q ? q.confirmed + q.falsePositives : 0;
  if (!q || judged < t.minJudged) add("quality", true, `datos de calidad insuficientes (${judged}/${t.minJudged} findings revisados)`, "advisory");
  else add("quality", q.falsePositiveRate <= t.falsePositiveRate && (q.errorRate === null || q.errorRate <= t.errorRate), `falsos positivos ${(q.falsePositiveRate * 100).toFixed(1)}% (≤ ${t.falsePositiveRate * 100}%), errores ${q.errorRate === null ? "—" : `${(q.errorRate * 100).toFixed(1)}%`}`);

  // documentationRef del catálogo (relativo al paquete) o, para plugins, el README del control.
  const docs = [control.documentationRef && path.join(PACKAGE_ROOT, ...control.documentationRef.split("/")), path.join(CONTROLS_DIR, controlId.replace(/\./g, "-"), "README.md")].filter(Boolean);
  const doc = docs.find((d) => fs.existsSync(d));
  add("documentation", !!doc, doc ? `documentación: ${path.relative(PACKAGE_ROOT, doc).split(path.sep).join("/")}` : `falta documentación (${control.documentationRef || "sin documentationRef"})`, "advisory");
  const owners = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"].map((f) => (input.repoRoot ? path.join(input.repoRoot, f) : null)).find((f) => f && fs.existsSync(f));
  const owned = owners && fs.readFileSync(owners, "utf8").split("\n").some((l) => l.trim() && !l.startsWith("#") && l.trim().split(/\s+/)[0].replace(/^\//, "").replace(/\/\*\*?$|\/$/, "") === unit.root);
  add("ownership", !!owned, owned ? `owner declarado para ${unit.root}` : `sin entrada CODEOWNERS para ${unit.root}`, "advisory");
  return finish(unitId, controlId, checks);
}

function finish(unitId, controlId, checks) {
  const blockers = checks.filter((c) => c.severity === "blocker" && !c.passed).map((c) => `${c.id}: ${c.detail}`);
  return { unitId, controlId, ready: blockers.length === 0, blockers, checks };
}

/**
 * Cambia el nivel de UN par unidad/control en la config del repo (R21.3–R21.4).
 * `warn` siempre se permite (rollback rápido); `enforce` exige readiness.
 * No toca evidencia ni otros controles.
 */
function planPromotion({ repoRoot, configFile, unitId, controlId, to, readiness }) {
  const abs = path.join(repoRoot, configFile);
  const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  const i = ((doc.workspace && doc.workspace.units) || []).findIndex((u) => u.id === unitId);
  if (i < 0) return { applicable: false, reason: `unidad ${unitId} no declarada en ${configFile}` };
  const unit = doc.workspace.units[i];
  const from = (unit.controls && unit.controls[controlId] && unit.controls[controlId].level) || null;
  if (to === "enforce" && (!readiness || !readiness.ready)) return { applicable: false, from, to, reason: "readiness insuficiente" };
  unit.controls = unit.controls || {};
  unit.controls[controlId] = { ...(unit.controls[controlId] || {}), level: to };
  return { applicable: true, from, to, pointer: `/workspace/units/${i}/controls/${controlId}/level`, next: `${JSON.stringify(doc, null, 2)}\n`, file: configFile };
}

function applyPromotion(repoRoot, plan) {
  const abs = path.join(repoRoot, plan.file);
  const tmp = `${abs}.kiritek-tmp`;
  fs.writeFileSync(tmp, plan.next);
  fs.renameSync(tmp, abs);
}

const PROMOTIONS = ".kiritek/engineering/promotions.jsonl";

/**
 * Registro append-only de cambios de nivel (T16.10): actor, origen, fecha,
 * config anterior/nueva (hash), evidencia que la sustentó y readiness. Vive
 * en el repo (fuera de lo ignorado) para revisarse por PR; nunca contiene
 * findings, razones ni contenido.
 */
function recordPromotion({ repoRoot, before, flags, plan, readiness, env = {}, now, resolveAfter }) {
  const evidence = before.report.capabilities
    .filter((r) => r.unitId === flags.unit && r.controlId === flags.control && r.evidenceRef)
    .map((r) => ({ moment: r.moment, evidenceRef: r.evidenceRef, status: r.status }));
  const entry = {
    schemaVersion: 1,
    at: now,
    actor: flags.actor || env.KIRITEK_ACTOR || env.GITHUB_ACTOR || env.GIT_AUTHOR_NAME || "unknown",
    origin: env.CI ? "ci" : "cli",
    unitId: flags.unit,
    controlId: flags.control,
    from: plan.from,
    to: plan.to,
    configHashBefore: before.resolvedConfig.configHash,
    configHashAfter: resolveAfter(),
    catalog: { version: before.snapshot.ref.version, digest: before.snapshot.ref.digest },
    evidence,
    readiness: readiness ? { ready: readiness.ready, checks: readiness.checks.length, blockers: readiness.blockers.length } : { ready: null, note: "rollback a warn: no requiere readiness" },
  };
  const abs = path.join(repoRoot, ...PROMOTIONS.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${JSON.stringify(entry)}\n`);
  return entry;
}

function readPromotions(repoRoot) {
  const abs = path.join(repoRoot, ...PROMOTIONS.split("/"));
  if (!fs.existsSync(abs)) return [];
  return fs.readFileSync(abs, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

module.exports = { DEFAULT_THRESHOLDS, PROMOTIONS, assessReadiness, planPromotion, applyPromotion, recordPromotion, readPromotions };
