"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const result = require("../../src/domain/result.js");
const evidence = require("../../src/domain/evidence.js");
const exception = require("../../src/domain/exception.js");
const policy = require("../../src/domain/policy.js");

const FIXED_CLOCK = "2026-10-01T12:00:00.000Z";
const fixedClock = () => FIXED_CLOCK;
const fixedNow = () => Date.parse(FIXED_CLOCK);

test("result: allow limpio es válido y hace round-trip JSON estable", () => {
  const r = result.createResult({
    controlId: "secrets.gitleaks",
    decision: result.DECISION.ALLOW,
    toolStatus: result.TOOL_STATUS.OK,
  });
  assert.equal(r.decision, "allow");
  assert.equal(r.severity, "info");
  const roundTrip = JSON.parse(JSON.stringify(r));
  assert.deepEqual(roundTrip, {
    schemaVersion: 1,
    controlId: "secrets.gitleaks",
    decision: "allow",
    severity: "info",
    toolStatus: "ok",
    findings: [],
  });
});

test("result: allow con hallazgos se rechaza", () => {
  assert.throws(
    () =>
      result.createResult({
        controlId: "c",
        decision: result.DECISION.ALLOW,
        findings: [
          { ruleId: "r", path: "a", severity: "high", fingerprint: "fp" },
        ],
      }),
    /allow.*no puede llevar hallazgos/
  );
});

test("result: deny sin hallazgos ni razón se rechaza", () => {
  assert.throws(
    () => result.createResult({ controlId: "c", decision: result.DECISION.DENY }),
    /requiere hallazgos o una razón/
  );
});

test("result: severidad no puede ser menor que la del hallazgo más severo", () => {
  assert.throws(
    () =>
      result.createResult({
        controlId: "c",
        decision: result.DECISION.DENY,
        severity: result.SEVERITY.LOW,
        findings: [{ ruleId: "r", path: "a", severity: "critical", fingerprint: "fp" }],
      }),
    /no puede ser menor/
  );
});

test("result: error exige toolStatus de error o razón", () => {
  assert.throws(
    () =>
      result.createResult({
        controlId: "c",
        decision: result.DECISION.ERROR,
        toolStatus: result.TOOL_STATUS.OK,
      }),
    /requiere toolStatus de error o una razón/
  );
  const ok = result.createResult({
    controlId: "c",
    decision: result.DECISION.ERROR,
    toolStatus: result.TOOL_STATUS.UNAVAILABLE,
  });
  assert.equal(ok.decision, "error");
});

test("result: campo prohibido (secret) se rechaza en createResult y createFinding", () => {
  assert.throws(
    () =>
      result.createResult({
        controlId: "c",
        decision: result.DECISION.DENY,
        reason: "x",
        secret: "AKIAEXAMPLE",
      }),
    /campo prohibido "secret"/
  );
  assert.throws(
    () => result.createFinding({ ruleId: "r", path: "a", severity: "high", fingerprint: "fp", line: "x" }),
    /campo prohibido "line"/
  );
});

test("result: compareSeverity y maxSeverity", () => {
  assert.ok(result.compareSeverity("critical", "low") > 0);
  assert.equal(result.maxSeverity(["low", "high", "medium"]), "high");
  assert.equal(result.maxSeverity([]), "info");
});

test("evidence: createEvidence determinista con clock/id inyectables", () => {
  const e = evidence.createEvidence(
    {
      control: "secrets.gitleaks",
      command: "gitleaks protect --staged",
      toolVersion: "8.0.0",
      configHash: "sha256:abc",
      scope: "staged",
      exitCode: 0,
      decision: "allow",
      commit: "deadbeef",
    },
    { clock: fixedClock, idGenerator: () => "ev-test-1" }
  );
  assert.equal(e.id, "ev-test-1");
  assert.equal(e.createdAt, FIXED_CLOCK);
});

test("evidence: supportsVerification aplica exitCode, commit, scope y expiración", () => {
  const base = {
    control: "c",
    command: "cmd",
    toolVersion: "1",
    configHash: "h",
    scope: "staged",
    exitCode: 0,
    decision: "allow",
    commit: "abc",
  };
  const good = evidence.createEvidence(base, { clock: fixedClock, idGenerator: () => "id" });
  assert.equal(
    evidence.supportsVerification(good, { commit: "abc", scope: "staged", maxAgeHours: 24 }, { now: fixedNow }).ok,
    true
  );
  // commit distinto
  assert.equal(evidence.supportsVerification(good, { commit: "other" }, { now: fixedNow }).ok, false);
  // expirada
  const future = () => Date.parse(FIXED_CLOCK) + 48 * 3600 * 1000;
  assert.equal(evidence.supportsVerification(good, { maxAgeHours: 24 }, { now: future }).ok, false);
  // exit code != 0
  const failed = evidence.createEvidence({ ...base, exitCode: 1 }, { clock: fixedClock, idGenerator: () => "id2" });
  assert.equal(evidence.supportsVerification(failed, {}, { now: fixedNow }).ok, false);
});

test("exception: requiere alcance mínimo y expiración futura acotada", () => {
  assert.throws(
    () =>
      exception.createException(
        {
          controlId: "c",
          reason: "x",
          owner: "o",
          ticket: "T-1",
          expiresAt: "2026-10-15T12:00:00.000Z",
        },
        { clock: fixedClock }
      ),
    /scopeFingerprint o scopePath/
  );
  // expiración excesiva
  assert.throws(
    () =>
      exception.createException(
        {
          controlId: "c",
          scopePath: "a.txt",
          reason: "x",
          owner: "o",
          ticket: "T-1",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        { clock: fixedClock }
      ),
    /no puede exceder/
  );
});

test("exception: isActive y covers por fingerprint", () => {
  const exc = exception.createException(
    {
      controlId: "c",
      scopeFingerprint: "a.txt:generic:1",
      reason: "x",
      owner: "o",
      ticket: "T-1",
      expiresAt: "2026-10-15T12:00:00.000Z",
    },
    { clock: fixedClock }
  );
  assert.equal(exception.isActive(exc, { now: fixedNow }).active, true);
  const finding = result.createFinding({
    ruleId: "generic",
    path: "a.txt",
    severity: "high",
    fingerprint: "a.txt:generic:1",
  });
  assert.equal(exception.covers(exc, finding, { now: fixedNow }), true);
  const other = result.createFinding({
    ruleId: "generic",
    path: "a.txt",
    severity: "high",
    fingerprint: "a.txt:generic:999",
  });
  assert.equal(exception.covers(exc, other, { now: fixedNow }), false);
});

test("policy: createPolicyInput valida enums y normaliza", () => {
  const p = policy.createPolicyInput({
    event: "pre-commit",
    mode: "enforce",
    repositoryRoot: "/repo",
    paths: ["a.txt", "b.txt"],
  });
  assert.equal(p.actorType, "unknown");
  assert.deepEqual(p.paths, ["a.txt", "b.txt"]);
  assert.throws(
    () => policy.createPolicyInput({ event: "nope", mode: "enforce", repositoryRoot: "/repo" }),
    /event.*inválido/
  );
});
