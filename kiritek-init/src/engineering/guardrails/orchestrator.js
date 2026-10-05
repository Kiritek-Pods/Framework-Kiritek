"use strict";

/**
 * Orquestador engineering (T06; design §8).
 *
 * Flujo único por (unidad, control), en orden determinista:
 *
 *   nivel off? → momento cubierto? → implementación enlazada? → perfiles →
 *   N/A gobernado → collectors (timeout) → normalización → aplicabilidad →
 *   frescura/conflicto → evaluator puro → waivers → compuerta de confianza
 *   → agregación → verificación de privacidad → adapter.
 *
 * Cada abstención o fallo operativo produce un envelope explícito con su
 * estado; nunca se omite un par unidad/control ni se presenta como allow.
 * Las unidades fuera de alcance quedan `not_evaluated` con razón.
 */

const c = require("./contracts/common.js");
const { createPracticeInput } = require("./contracts/practice-input.js");
const { createEngineeringEvidence } = require("./contracts/evidence.js");
const { createApplicability } = require("./contracts/applicability.js");
const { EVALUATION_STATE } = require("./contracts/result-envelope.js");
const { DECISION } = require("./contracts/policy-result.js");
const { hashJson } = require("./canonical.js");
const { pointer } = require("./config/provenance.js");
const { runCollectors } = require("./pipeline/collect.js");
const { normalizeObservations } = require("./pipeline/normalize.js");
const { resolveApplicability } = require("./pipeline/applicability.js");
const { runEvaluator, EvaluatorError } = require("./pipeline/evaluate.js");
const { findGovernedNA, applyWaivers } = require("./pipeline/exceptions.js");
const { enforceTrustGate, aggregateRun } = require("./pipeline/aggregate.js");
const { assertPublishable } = require("./pipeline/redact.js");
const { raise } = require("./errors.js");

const CONFIDENCE_RANK = Object.freeze({ deterministic: 4, high: 3, medium: 2, low: 1, unknown: 0 });
const ACTOR_BY_MOMENT = Object.freeze({ agent: "agent", "pre-commit": "human", pr: "ci", release: "release" });
const REDACTION_POLICY_VERSION = "1.0.0";

function minConfidence(list) {
  if (!list.length) return c.CONFIDENCE.UNKNOWN;
  return list.reduce((a, b) => (CONFIDENCE_RANK[b] < CONFIDENCE_RANK[a] ? b : a));
}

/** Clase agregada de la evidencia: heurística domina; manual se declara. */
function aggregateEvidenceClass(observations) {
  if (!observations.length) return "none";
  if (observations.some((o) => o.evidenceClass === c.EVIDENCE_CLASS.HEURISTIC)) return c.EVIDENCE_CLASS.HEURISTIC;
  if (observations.some((o) => o.evidenceClass === c.EVIDENCE_CLASS.MANUAL)) return c.EVIDENCE_CLASS.MANUAL;
  return c.EVIDENCE_CLASS.DETERMINISTIC;
}

function levelProvenance(resolvedConfig, unitId, controlId) {
  const entry = resolvedConfig.provenance[`${pointer("units", unitId)}/controls/${pointer(controlId).slice(1)}/level`];
  if (!entry) return { sourceKind: "catalog", sourceRef: `catalog:${c.PACK_ID}#/controls/${controlId}` };
  const out = { sourceKind: entry.sourceKind, sourceRef: entry.sourceRef };
  if (entry.sourceVersion !== undefined) out.sourceVersion = entry.sourceVersion;
  return out;
}

function checkLinkage(control, impl) {
  if (!impl) return "CONTROL_NOT_IMPLEMENTED";
  const ids = (impl.collectors || []).map((x) => x.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...control.collectors].sort())) return "CONTROL_LINKAGE_MISMATCH";
  if (!impl.evaluator || typeof impl.evaluator.evaluate !== "function" || !c.SEMVER_RE.test(impl.evaluator.version || "")) return "CONTROL_LINKAGE_MISMATCH";
  if ((impl.collectors || []).some((x) => typeof x.collect !== "function" || !c.SEMVER_RE.test(x.version || ""))) return "CONTROL_LINKAGE_MISMATCH";
  return null;
}

/** Resultado operativo según el fallback del momento (nunca deny). */
function fallbackResult(control, moment, controlId, reason) {
  const m = control.moments.find((x) => x.moment === moment);
  const fallback = m ? m.fallback : "error-operational";
  if (fallback === "defer-to-later-surface") return null;
  if (fallback === "warn") return { schemaVersion: 1, controlId, decision: DECISION.WARN, severity: "info", toolStatus: "unavailable", findings: [], reason };
  return { schemaVersion: 1, controlId, decision: DECISION.ERROR, severity: "info", toolStatus: "unavailable", findings: [], reason };
}

/**
 * @param {object} input
 * @param {"agent"|"pre-commit"|"pr"|"release"} input.moment
 * @param {object} input.resolvedConfig    Salida de T03.
 * @param {object} input.catalogSnapshot   Snapshot de T02 (misma que la config).
 * @param {object} input.resolvedUnits     Salida de T04.
 * @param {object} input.scope             Salida de T05 `resolveScope`.
 * @param {Record<string, object>} input.controls  Implementaciones por id.
 * @param {object[]} [input.exceptions]    Waivers / N/A vigentes (T13).
 * @param {object[]} [input.suggestions]   Discovery (sólo informativo).
 * @param {() => string} [input.clock]     ISO-8601 inyectable.
 * @param {() => number} [input.nowMs]     Para duraciones.
 * @param {string} [input.platformKey]
 * @param {string} [input.repoRoot]
 * @param {(report) => any} [input.adapter]
 * @param {boolean} [input.verifyDeterminism=true]
 */
async function evaluateRun(input) {
  const clock = input.clock || (() => new Date().toISOString());
  const nowIso = clock();
  const nowMsAt = Date.parse(nowIso);
  const nowMs = input.nowMs || Date.now;
  const { resolvedConfig, catalogSnapshot: snap, resolvedUnits, scope, moment } = input;
  if (resolvedConfig.catalog.digest !== snap.ref.digest || resolvedUnits.catalog.digest !== snap.ref.digest) {
    raise("CATALOG_MIXED_VERSIONS", "config, unidades y ejecución deben usar la misma snapshot de catálogo");
  }
  const platformKey = input.platformKey || `${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`;
  // Sólo el hash: la ruta absoluta del repo nunca entra al PracticeInput.
  const repoHash = hashJson({ repository: input.repoRoot || "unknown" });
  const configHash = resolvedConfig.configHash;
  const catalogRef = { ...snap.ref };
  const envelopes = [];
  const events = [];
  const runDiagnostics = [...(scope.diagnostics || [])];
  const scopeByUnit = new Map(scope.units.map((u) => [u.unitId, u]));
  const configUnits = new Map(resolvedConfig.effective.units.map((u) => [u.unit.id, u.unit]));

  for (const unit of resolvedUnits.units) {
    const unitScope = scopeByUnit.get(unit.id);
    for (const control of snap.catalog.controls) {
      const level = unit.controls[control.id].level;
      const parameters = unit.controls[control.id].parameters;
      const scopeHash = unitScope ? unitScope.scopeHash : hashJson({ moment, revision: scope.revision, unitId: unit.id, outOfScope: true });
      const base = {
        domain: c.DOMAIN.ENGINEERING,
        packId: c.PACK_ID,
        catalog: catalogRef,
        control: {
          id: control.id,
          version: control.version,
          contractVersion: control.contractVersion,
          ...(control.enforcementContract
            ? { enforcementContractVersion: control.enforcementContract.approvedVersion, enforcementMoments: [...control.enforcementContract.moments] }
            : {}),
        },
        unit: { id: unit.id, rootHash: unit.rootHash },
        profiles: unit.profiles.map((p) => ({ id: p.id, version: p.version })),
        moment,
        level,
        revision: scope.revision,
        scopeHash,
        configHash,
        provenance: { level: levelProvenance(resolvedConfig, unit.id, control.id) },
        findingEvidence: [],
        suppressed: [],
        durationMs: 0,
        cache: "bypass",
      };
      const abstain = (state, extra = {}) => {
        const draft = {
          ...base,
          state,
          applicability: null,
          confidence: c.CONFIDENCE.UNKNOWN,
          evidenceClass: "none",
          evidenceFreshness: c.FRESHNESS.MISSING,
          evidenceCompleteness: "none",
          evidence: null,
          result: null,
          diagnostics: [],
          ...extra,
        };
        const gated = enforceTrustGate(draft);
        envelopes.push(gated.envelope);
        events.push(...gated.events);
      };

      if (level === c.LEVEL.OFF) {
        abstain(EVALUATION_STATE.OFF);
        continue;
      }
      if (!unitScope) {
        abstain(EVALUATION_STATE.NOT_EVALUATED, { diagnostics: [{ code: "NOT_IN_SCOPE", message: "la unidad no está en el alcance de este momento" }] });
        continue;
      }
      if (!control.moments.some((m) => m.moment === moment)) {
        abstain(EVALUATION_STATE.NOT_EVALUATED, { diagnostics: [{ code: "MOMENT_NOT_COVERED", message: `el control no se ejecuta en ${moment}` }] });
        continue;
      }
      const impl = input.controls ? input.controls[control.id] : undefined;
      const linkage = checkLinkage(control, impl);
      if (linkage) {
        abstain(EVALUATION_STATE.UNAVAILABLE, {
          diagnostics: [{ code: linkage, message: "implementación del control ausente o no enlazada con el catálogo" }],
          result: fallbackResult(control, moment, control.id, `${linkage}: control no ejecutable`),
        });
        continue;
      }

      // Perfiles (antes de observar: un control sin perfil no recolecta).
      const preliminary = resolveApplicability({ unit, control, moment, scopeHash, observations: [], parameters, suggestions: input.suggestions });
      if (preliminary.status !== "applicable") {
        abstain(preliminary.status === "unknown" ? EVALUATION_STATE.UNKNOWN : EVALUATION_STATE.NOT_APPLICABLE, {
          applicability: preliminary,
          confidence: preliminary.confidence,
          diagnostics: preliminary.reasons,
        });
        continue;
      }

      // N/A gobernado: documenta excepción funcional sin alterar el perfil.
      const na = findGovernedNA(input.exceptions, { unitId: unit.id, controlId: control.id, scopeHash, nowMs: nowMsAt });
      if (na.record) {
        const reason = { code: "GOVERNED_NA", message: `no aplicable por excepción gobernada ${na.record.id}` };
        abstain(EVALUATION_STATE.NOT_APPLICABLE, {
          applicability: createApplicability({ ...preliminary, status: "not_applicable", reasons: [reason] }),
          confidence: c.CONFIDENCE.DETERMINISTIC,
          suppressed: [{ kind: "governed-na", ref: na.record.id, expiresAt: na.record.expiresAt }],
          diagnostics: [reason, ...na.diagnostics],
        });
        continue;
      }
      const exceptionDiagnostics = [...na.diagnostics];

      // Observación aislada.
      const budget = Math.min(
        control.timeoutMs,
        control.moments.find((m) => m.moment === moment).budgetMs,
        resolvedConfig.effective.execution.budgetsMs[moment]
      );
      const started = nowMs();
      const collected = await runCollectors(
        impl.collectors,
        { moment, unit: { id: unit.id, root: unit.root, owns: unit.owns, excludes: unit.excludes }, controlId: control.id, parameters, scope: { paths: unitScope.paths, scopeHash, revision: scope.revision } },
        { timeoutMs: budget, nowMs }
      );
      const identity = { controlId: control.id, unitId: unit.id, revision: scope.revision, scopeHash, configHash, catalogDigest: catalogRef.digest, observedAt: nowIso };
      let normalized;
      try {
        normalized = normalizeObservations(collected, identity, {
          controlNormalizer: impl.normalizer,
          maxAgeSeconds: control.freshness.maxAgeSeconds,
          nowMs: () => nowMsAt,
        });
      } catch (err) {
        abstain(EVALUATION_STATE.UNAVAILABLE, {
          diagnostics: [{ code: "NORMALIZATION", message: "la normalización de observaciones falló" }],
          result: fallbackResult(control, moment, control.id, "NORMALIZATION: observaciones no normalizables"),
        });
        continue;
      }
      const { observations, staleIds } = normalized;
      const durationMs = Math.max(0, nowMs() - started);
      const usable = observations.filter((o) => o.status === "complete");
      const timeouts = observations.filter((o) => o.status === "timeout");
      const conflicts = observations.filter((o) => o.status === "conflict");
      const limits = observations.flatMap((o) => o.limitations);

      if (conflicts.length) {
        abstain(EVALUATION_STATE.CONFLICT, {
          applicability: preliminary,
          confidence: c.CONFIDENCE.UNKNOWN,
          evidenceFreshness: c.FRESHNESS.CONFLICT,
          evidenceCompleteness: "partial",
          evidenceClass: aggregateEvidenceClass(conflicts),
          evidence: { id: `conflict/${control.id}`, revision: scope.revision, scopeHash, configHash, catalogDigest: catalogRef.digest, unitId: unit.id, controlId: control.id },
          diagnostics: [{ code: "EVIDENCE_CONFLICT", message: `${conflicts.length} observación(es) en conflicto: resolver antes de evaluar` }, ...limits],
          result: { schemaVersion: 1, controlId: control.id, decision: DECISION.ERROR, severity: "info", toolStatus: "unavailable", findings: [], reason: "EVIDENCE_CONFLICT: evidencia determinista contradictoria" },
          durationMs,
        });
        continue;
      }
      if (usable.length === 0) {
        const state = timeouts.length ? EVALUATION_STATE.TIMEOUT : EVALUATION_STATE.UNAVAILABLE;
        abstain(state, {
          applicability: preliminary,
          diagnostics: limits.length ? limits : [{ code: "NO_OBSERVATIONS", message: "no hay observaciones utilizables" }],
          result: fallbackResult(control, moment, control.id, `${state}: sin evidencia utilizable`),
          durationMs,
        });
        continue;
      }

      // Aplicabilidad del control con observaciones reales.
      const applicability = resolveApplicability({ unit, control, moment, scopeHash, observations: usable, parameters, suggestions: input.suggestions, hook: impl.applicability });
      if (applicability.status !== "applicable" || applicability.confidence === c.CONFIDENCE.UNKNOWN) {
        const state =
          applicability.status === "not_applicable" ? EVALUATION_STATE.NOT_APPLICABLE : applicability.status === "unavailable" ? EVALUATION_STATE.UNAVAILABLE : EVALUATION_STATE.UNKNOWN;
        abstain(state, {
          applicability,
          confidence: applicability.confidence,
          diagnostics: applicability.reasons.length ? applicability.reasons : [{ code: "APPLICABILITY_AMBIGUOUS", message: "aplicabilidad ambigua: abstención" }],
          durationMs,
        });
        continue;
      }

      // Frescura: evidencia vencida nunca sustenta deny.
      const evidenceClass = aggregateEvidenceClass(usable);
      const confidence = minConfidence(usable.map((o) => o.confidence));
      const manual = usable.find((o) => o.evidenceClass === c.EVIDENCE_CLASS.MANUAL);
      let evidence;
      try {
        evidence = createEngineeringEvidence(
          {
            id: `eng-ev/${hashJson({ unit: unit.id, control: control.id, scopeHash, configHash, at: nowIso }).slice(7, 31)}`,
            type: "control-run",
            evidenceClass,
            confidence,
            domain: c.DOMAIN.ENGINEERING,
            packId: c.PACK_ID,
            catalog: catalogRef,
            control: { id: control.id, version: control.version, contractVersion: control.contractVersion },
            collectorVersions: Object.fromEntries(impl.collectors.map((x) => [x.id, x.version])),
            evaluatorVersion: impl.evaluator.version,
            unitId: unit.id,
            revision: scope.revision,
            scopeHash,
            configHash,
            platformKey,
            createdAt: nowIso,
            durationMs,
            cache: usable.some((o) => o.cache === "hit") ? "hit" : "miss",
            observationRefs: usable.map((o) => o.observationId),
            redaction: { policyVersion: REDACTION_POLICY_VERSION, verified: true },
            ...(manual ? { manualReview: manual.facts.review } : {}),
          },
          { clock }
        );
      } catch (err) {
        abstain(EVALUATION_STATE.UNAVAILABLE, {
          applicability,
          diagnostics: [{ code: "EVIDENCE_INVALID", message: "no se pudo construir la evidencia de la ejecución" }],
          result: fallbackResult(control, moment, control.id, "EVIDENCE_INVALID"),
          durationMs,
        });
        continue;
      }
      const binding = { id: evidence.id, revision: evidence.revision, scopeHash: evidence.scopeHash, configHash: evidence.configHash, catalogDigest: evidence.catalog.digest, unitId: evidence.unitId, controlId: evidence.control.id };
      const stale = staleIds.length > 0;
      // Cualquier observación no completa (parcial, timeout, inválida,
      // indisponible) deja la evidencia incompleta: se evalúa para informar,
      // pero nunca puede sostener un deny (design §10.1).
      const incomplete = observations.length !== usable.length;
      const evidenceFields = {
        applicability,
        confidence: evidence.confidence,
        evidenceClass: evidence.evidenceClass,
        evidenceFreshness: stale ? c.FRESHNESS.STALE : c.FRESHNESS.FRESH,
        evidenceCompleteness: incomplete ? "partial" : "complete",
        evidence: binding,
        durationMs,
        cache: evidence.cache,
      };
      if (stale) {
        abstain(EVALUATION_STATE.STALE, {
          ...evidenceFields,
          diagnostics: [{ code: "EVIDENCE_STALE", message: `${staleIds.length} observación(es) superan la antigüedad máxima del control: reevaluar` }],
          result: { schemaVersion: 1, controlId: control.id, decision: DECISION.WARN, severity: "info", toolStatus: "ok", findings: [], reason: "EVIDENCE_STALE: evidencia vencida; se requiere reevaluación" },
        });
        continue;
      }

      // Evaluator puro.
      const practiceInput = createPracticeInput({
        event: moment,
        repository: { rootHash: repoHash },
        actorType: ACTOR_BY_MOMENT[moment],
        revision: {
          commit: scope.revision,
          ...(scope.baseRevision ? { baseCommit: scope.baseRevision } : {}),
          ...(moment === "pre-commit" ? { dirtyState: "staged" } : moment === "agent" ? { dirtyState: "dirty" } : {}),
        },
        scope: { paths: unitScope.paths, scopeHash, ...(scope.artifactRef ? { artifactRef: scope.artifactRef } : {}) },
        unit: configUnits.get(unit.id),
        profileRefs: applicability.profileRefs,
        control,
        level,
        effectiveConfig: parameters,
        configHash,
        provenance: { level: levelProvenance(resolvedConfig, unit.id, control.id) },
        catalog: catalogRef,
        observations: usable,
        applicability,
        clockRef: nowIso,
        platformKey,
      });
      let evaluated;
      try {
        evaluated = runEvaluator(impl.evaluator, practiceInput, {
          verifyDeterminism: input.verifyDeterminism !== false,
          allowedEvidenceClasses: control.enforcementContract ? control.enforcementContract.evidenceTypes : [c.EVIDENCE_CLASS.DETERMINISTIC],
        });
      } catch (err) {
        const code = err instanceof EvaluatorError ? err.code : "EVALUATOR_ERROR";
        const draft = {
          ...base,
          ...evidenceFields,
          state: EVALUATION_STATE.EVALUATED,
          diagnostics: [{ code, stage: "evaluate", message: err instanceof EvaluatorError ? err.message : "error interno del evaluator" }],
          result: { schemaVersion: 1, controlId: control.id, decision: DECISION.ERROR, severity: "info", toolStatus: "ok", findings: [], reason: `${code}: error operativo, no es incumplimiento` },
        };
        const gated = enforceTrustGate(draft);
        envelopes.push(gated.envelope);
        events.push(...gated.events);
        continue;
      }

      const waived = applyWaivers(evaluated.result.findings, input.exceptions, { unitId: unit.id, controlId: control.id, scopeHash, nowMs: nowMsAt });
      let result = { ...evaluated.result, findings: waived.findings };
      const diagnostics = [...exceptionDiagnostics, ...waived.diagnostics];
      if (evaluated.reclassified.length) {
        diagnostics.push({ code: "FINDING_RECLASSIFIED", stage: "evaluate", message: `${evaluated.reclassified.length} finding(s) sin respaldo determinista reclasificados como heurísticos` });
      }
      if (waived.suppressed.length && [DECISION.ALLOW, DECISION.DENY].includes(result.decision)) {
        const active = result.findings.some((f) => f.status !== "suppressed");
        if (!active) result = { ...result, decision: DECISION.WARN, reason: "SUPPRESSED_DEBT: findings suprimidos por waiver vigente; deuda conocida" };
      }
      const draft = {
        ...base,
        ...evidenceFields,
        state: EVALUATION_STATE.EVALUATED,
        result,
        findingEvidence: evaluated.findingEvidence,
        suppressed: waived.suppressed,
        diagnostics,
      };
      if (incomplete) {
        draft.diagnostics = [...draft.diagnostics, { code: "EVIDENCE_INCOMPLETE", message: `${observations.length - usable.length} observación(es) no completas: el resultado no puede bloquear` }];
      }
      const gated = enforceTrustGate(draft);
      envelopes.push(gated.envelope);
      events.push(...gated.events);
    }
  }

  const report = aggregateRun({ moment, catalog: catalogRef, configHash, revision: scope.revision, envelopes, events, diagnostics: runDiagnostics });
  assertPublishable(report);
  if (input.adapter) return { report, adapted: input.adapter(report) };
  return { report };
}

module.exports = { evaluateRun, aggregateEvidenceClass, minConfidence };
