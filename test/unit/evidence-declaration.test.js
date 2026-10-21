"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  validateDeclaration,
  isVerifiedState,
  normalizeState,
} = require("../../src/policy/evidence-declaration.js");

const FX = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "declarations", "declarations.json"), "utf8")
);

const nowFresh = () => Date.parse(FX.nowFresh);
const nowExpired = () => Date.parse(FX.nowExpired);

// --- 18.5 / 11.4: estado verificado CON evidencia fresca → pasa ---

test("verificado con evidencia fresca y del mismo alcance → ok", () => {
  const res = validateDeclaration(
    { state: "verificado", evidence: FX.freshEvidence },
    FX.expectation,
    { now: nowFresh }
  );
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.state, "verified");
  assert.equal(res.requiresEvidence, true);
});

test("alias en inglés 'tested'/'working' también exigen y aceptan evidencia", () => {
  for (const state of ["tested", "working", "cumple"]) {
    const res = validateDeclaration(
      { state, evidence: FX.freshEvidence },
      FX.expectation,
      { now: nowFresh }
    );
    assert.equal(res.ok, true, `${state}: ${res.reason || ""}`);
  }
});

// --- 18.5 / 11.4: estado verificado SIN evidencia → falla (fail-closed) ---

test("verificado sin evidencia → rechazado (fail-closed)", () => {
  const res = validateDeclaration({ state: "verificado" }, FX.expectation, { now: nowFresh });
  assert.equal(res.ok, false);
  assert.equal(res.requiresEvidence, true);
  assert.match(res.reason, /evidencia/);
});

test("verificado con evidencia EXPIRADA → rechazado", () => {
  const res = validateDeclaration(
    { state: "verificado", evidence: FX.freshEvidence },
    FX.expectation,
    { now: nowExpired }
  );
  assert.equal(res.ok, false);
  assert.match(res.reason, /expirad/);
});

test("verificado con evidencia de OTRO commit → rechazado", () => {
  const res = validateDeclaration(
    { state: "verificado", evidence: FX.freshEvidence },
    { ...FX.expectation, commit: "deadbeef" },
    { now: nowFresh }
  );
  assert.equal(res.ok, false);
  assert.match(res.reason, /commit/);
});

test("verificado con evidencia de ejecución fallida (exitCode!=0) → rechazado", () => {
  const res = validateDeclaration(
    { state: "verificado", evidence: FX.failedEvidence },
    FX.expectation,
    { now: nowFresh }
  );
  assert.equal(res.ok, false);
});

// --- 18.4 / 11.2: estados honestos NO requieren evidencia ---

test("estados honestos pasan sin evidencia", () => {
  for (const state of ["no_ejecutado", "unverified", "partial", "warning", "failed"]) {
    const res = validateDeclaration({ state }, FX.expectation, { now: nowFresh });
    assert.equal(res.ok, true, `${state} debería aceptarse sin evidencia`);
    assert.equal(res.requiresEvidence, false);
  }
});

// --- Entradas inválidas ---

test("declaración ausente o sin estado → rechazada", () => {
  assert.equal(validateDeclaration(null).ok, false);
  assert.equal(validateDeclaration({}).ok, false);
});

// --- Helpers ---

test("isVerifiedState reconoce alias en español e inglés", () => {
  assert.equal(isVerifiedState("verificado"), true);
  assert.equal(isVerifiedState("tested"), true);
  assert.equal(isVerifiedState("no_ejecutado"), false);
  assert.equal(normalizeState("Verificado"), "verified");
});
