"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { validateAgainst, loadSchema } = require("../../src/domain/schema-validator.js");
const result = require("../../src/domain/result.js");
const evidence = require("../../src/domain/evidence.js");

const FIXTURES = path.join(__dirname, "..", "fixtures");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("schemas: todos cargan y declaran additionalProperties:false en el root", () => {
  for (const name of ["result", "evidence", "config", "audit", "exception", "break-glass"]) {
    const schema = loadSchema(name);
    assert.equal(schema.additionalProperties, false, `${name} debe negar propiedades extra`);
  }
});

test("fixtures válidos pasan su schema", () => {
  assert.equal(validateAgainst("result", readJson(path.join(FIXTURES, "valid/result.allow.json"))).valid, true);
  assert.equal(validateAgainst("result", readJson(path.join(FIXTURES, "valid/result.deny.json"))).valid, true);
  assert.equal(validateAgainst("evidence", readJson(path.join(FIXTURES, "valid/evidence.json"))).valid, true);
  assert.equal(validateAgainst("exception", readJson(path.join(FIXTURES, "valid/exception.json"))).valid, true);
});

test("fixture inválido: propiedad prohibida (secret) es rechazada por el schema", () => {
  const r = validateAgainst("result", readJson(path.join(FIXTURES, "invalid/result.forbidden-field.json")));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /propiedad no permitida "secret"/.test(e)));
});

test("fixture inválido: excepción sin alcance es rechazada por anyOf", () => {
  const r = validateAgainst("exception", readJson(path.join(FIXTURES, "invalid/exception.no-scope.json")));
  assert.equal(r.valid, false);
});

test("validador: enum, const y minLength", () => {
  const bad = validateAgainst("result", {
    schemaVersion: 2,
    controlId: "",
    decision: "nope",
    severity: "info",
    toolStatus: "ok",
    findings: [],
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /const/.test(e)));
  assert.ok(bad.errors.some((e) => /enum/.test(e)));
  assert.ok(bad.errors.some((e) => /minLength/.test(e)));
});

test("contrato ↔ schema: createResult produce objetos schema-valid", () => {
  const r = result.createResult({
    controlId: "secrets.gitleaks",
    decision: result.DECISION.DENY,
    reason: "secreto detectado",
    severity: result.SEVERITY.CRITICAL,
    toolStatus: result.TOOL_STATUS.OK,
    findings: [
      { ruleId: "aws", path: "a.env", severity: "critical", fingerprint: "a.env:aws:1", lineNumber: 3 },
    ],
  });
  assert.equal(validateAgainst("result", JSON.parse(JSON.stringify(r))).valid, true);
});

test("contrato ↔ schema: createEvidence produce objetos schema-valid", () => {
  const e = evidence.createEvidence(
    {
      control: "c",
      command: "cmd",
      toolVersion: "1",
      configHash: "h",
      scope: "staged",
      exitCode: 0,
      decision: "allow",
    },
    { clock: () => "2026-10-01T12:00:00.000Z", idGenerator: () => "ev-1" }
  );
  assert.equal(validateAgainst("evidence", JSON.parse(JSON.stringify(e))).valid, true);
});

test("privacidad: ningún fixture contiene canarios sensibles", () => {
  // Canarios: patrones de credenciales reales. Los fixtures deben usar sólo
  // valores no funcionales (placeholders, SEC-xxx, rutas). Este barrido evita
  // que un secreto real se cuele como dato de prueba (G.12).
  const canaries = [
    /AKIA[0-9A-Z]{16}/, // AWS access key real
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /xox[baprs]-[0-9A-Za-z-]{10,}/, // Slack token
    /ghp_[0-9A-Za-z]{36}/, // GitHub PAT
  ];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const content = fs.readFileSync(full, "utf8");
        for (const c of canaries) {
          assert.equal(c.test(content), false, `${full} contiene un patrón de canario sensible`);
        }
      }
    }
  }
  walk(FIXTURES);
});
