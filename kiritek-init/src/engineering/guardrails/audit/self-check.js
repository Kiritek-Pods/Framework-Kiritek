"use strict";

/**
 * Self-checks sintéticos de la auditoría profunda (T15.3, R19.6).
 *
 * Sin producto ni datos reales: cada control builtin evalúa observaciones
 * fabricadas y el resultado pasa por el contrato de envelope en `enforce`:
 *  - un fallo determinista debe ser ELEGIBLE para bloquear;
 *  - una señal heurística nunca: un deny heurístico se rechaza con
 *    DENY_NOT_ELIGIBLE;
 *  - la publicación detecta un canario sintético (REDACTION_FAILED).
 */

const { createResultEnvelope } = require("../contracts/result-envelope.js");
const { assertNoLeaks } = require("../privacy/validate-output.js");

const H = (ch) => `sha256:${ch.repeat(64)}`;
const REV = "0123456789abcdef0123456789abcdef01234567";
const NOW = "2026-01-01T00:00:00.000Z";
const CANARY = "KCANARY-selfcheck-5e1f";
const PROFILES = {
  "search.input-rate": ["search"],
  "app.minimum-supported-version": ["mobile-app"],
  "web.module-announcement": ["web", "module-launch"],
};

function obs(kind, facts, evidenceClass = "deterministic") {
  return { observationId: `obs/selfcheck/${kind}`, kind, facts, evidenceClass, confidence: evidenceClass === "deterministic" ? "deterministic" : "low", status: "complete" };
}

/** Casos sintéticos por control: { deterministic, heuristic } → observaciones + config. */
const CASES = {
  "search.input-rate": {
    params: { minChars: 3, behaviorContract: "apps/x/search.contract.json" },
    deterministic: [
      obs("search-contract", { declared: true, valid: true, errorCodes: [], triggers: "remote", cancellation: "supported", equivalence: "trim-lowercase", harnessKind: "node-adapter", minCharsException: false }),
      obs("search-behavior", {
        scenario: "burst",
        params: { minChars: 3, windowMs: 250, strategy: "equivalent", dedupeWindowMs: 0, cancellation: "supported", equivalence: "trim-lowercase" },
        minCharsException: false,
        events: [
          { type: "request-start", t: 0, len: 5, seq: 1, rid: "r1", qid: "q1", key: "k1" },
          { type: "request-start", t: 10, len: 6, seq: 2, rid: "r2", qid: "q2", key: "k2" },
        ],
      }),
    ],
    heuristic: [obs("search-contract", { declared: false, valid: false, errorCodes: [] }), obs("search-signals", { signals: [{ signal: "SEARCH_HANDLER", path: "apps/x/search.ts" }], filesScanned: 1, truncated: false }, "heuristic")],
  },
  "app.minimum-supported-version": {
    params: { policyContract: "apps/x/version-policy.json" },
    deterministic: [obs("version-contract", { declared: true, valid: false, errorCodes: ["CONTRACT_SCHEMA"] })],
    heuristic: [obs("version-contract", { declared: false, valid: false, errorCodes: [] }), obs("version-signals", { signals: [{ signal: "VERSION_GATE_LOGIC", path: "apps/x/gate.dart" }], filesScanned: 1, truncated: false }, "heuristic")],
  },
  "web.module-announcement": {
    params: { launchManifest: "apps/x/launch.json", supportedChannels: ["in-app"] },
    deterministic: [obs("announcement-manifest", { declared: true, valid: false, errorCodes: ["MANIFEST_SCHEMA"] })],
    heuristic: [obs("announcement-manifest", { declared: false, valid: false, errorCodes: [] }), obs("announcement-signals", { signals: [{ signal: "POSSIBLE_NEW_MODULE", path: "apps/x/src/modules/m/index.tsx" }], pathsScanned: 1 }, "heuristic")],
  },
};

function envelopeDraft(controlId, result, evidenceClass) {
  const profiles = (PROFILES[controlId] || []).map((id) => ({ id, version: "1.0.0" }));
  const findings = (result.findings || []).map((f, i) => ({ ruleId: f.ruleId, path: f.path, severity: f.severity, fingerprint: f.fingerprint || `fp-${i}`, status: "new", remediation: f.remediation || "—" }));
  return {
    schemaVersion: 2,
    domain: "engineering",
    packId: "engineering/guardrails",
    catalog: { id: "engineering/guardrails", version: "1.0.0", digest: H("a") },
    control: { id: controlId, version: "1.0.0", contractVersion: "1.0.0", enforcementContractVersion: "1.0.0", enforcementMoments: ["pr"] },
    unit: { id: "selfcheck/unit", rootHash: H("d") },
    profiles,
    moment: "pr",
    level: "enforce",
    state: "evaluated",
    revision: REV,
    scopeHash: H("b"),
    configHash: H("c"),
    applicability: { status: "applicable", confidence: "deterministic", reasons: [], sources: [], unitId: "selfcheck/unit", controlId, profileRefs: profiles, moment: "pr", scopeHash: H("b") },
    confidence: evidenceClass === "deterministic" ? "deterministic" : "low",
    evidenceClass,
    evidenceFreshness: "fresh",
    evidenceCompleteness: "complete",
    evidence: { id: "eng-ev-selfcheck", revision: REV, scopeHash: H("b"), configHash: H("c"), catalogDigest: H("a"), unitId: "selfcheck/unit", controlId },
    provenance: { level: { sourceKind: "unit", sourceRef: "selfcheck" } },
    result: { schemaVersion: 1, controlId, decision: result.decision, severity: "high", toolStatus: "ok", findings, ...(result.reason ? { reason: "self-check" } : {}) },
    findingEvidence: (result.findings || []).map((f, i) => ({ fingerprint: f.fingerprint || `fp-${i}`, evidenceClass: f.evidenceClass || evidenceClass })),
    suppressed: [],
    diagnostics: [],
    durationMs: 0,
    cache: "bypass",
  };
}

function evaluate(impl, controlId, params, observations) {
  return impl.evaluator.evaluate({ effectiveConfig: params, observations, unit: { id: "selfcheck/unit", root: "apps/x" }, event: "pr", clockRef: NOW, scope: { paths: ["apps/x/a.ts"] } });
}

/**
 * @param {Record<string, object>} controls  Implementaciones builtin.
 * @returns {{passed: boolean, checks: {id, controlId?, passed, detail}[]}}
 */
function runSelfChecks(controls) {
  const checks = [];
  const add = (id, controlId, passed, detail) => checks.push({ id, ...(controlId ? { controlId } : {}), passed: !!passed, detail });
  for (const [controlId, c] of Object.entries(CASES)) {
    const impl = controls[controlId];
    if (!impl) {
      add("implementation", controlId, false, "control sin implementación");
      continue;
    }
    try {
      const det = evaluate(impl, controlId, c.params, c.deterministic);
      const env = createResultEnvelope(envelopeDraft(controlId, det, "deterministic"));
      add("deterministic-eligible", controlId, det.decision === "deny" && env.blockingEligible === true, `decision=${det.decision} eligible=${env.blockingEligible}`);
    } catch (err) {
      add("deterministic-eligible", controlId, false, err.code || "ERROR");
    }
    try {
      const heu = evaluate(impl, controlId, c.params, c.heuristic);
      const env = createResultEnvelope(envelopeDraft(controlId, heu, "heuristic"));
      const forced = envelopeDraft(controlId, { ...heu, decision: "deny" }, "heuristic");
      let rejected = false;
      try {
        createResultEnvelope(forced);
      } catch (err) {
        rejected = err.code === "DENY_NOT_ELIGIBLE";
      }
      add("heuristic-never-blocks", controlId, heu.decision === "warn" && env.blockingEligible === false && rejected, `decision=${heu.decision} eligible=${env.blockingEligible} forcedDenyRejected=${rejected}`);
    } catch (err) {
      add("heuristic-never-blocks", controlId, false, err.code || "ERROR");
    }
  }
  let blocked = false;
  try {
    assertNoLeaks({ note: `fuga ${CANARY}` }, { canaries: [CANARY] });
  } catch (err) {
    blocked = err.code === "REDACTION_FAILED";
  }
  add("redaction-canary", null, blocked, blocked ? "canario sintético bloqueado" : "el canario no fue detectado");
  return { passed: checks.every((x) => x.passed), checks };
}

module.exports = { runSelfChecks, CASES, envelopeDraft };
