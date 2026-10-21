"use strict";

// T23: `ui.file-upload` — límites antes de subir, progreso, cancelar, reintentar y sin subidas dobles.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl, evaluateWith } = require("../helpers/behavior-controls.js");

const SPEC = { slug: "ui-file-upload", factory: "createUploadUnderTest", contractKind: "uploads-contract", behaviorKind: "uploads-behavior", fixtures: "uploads", param: "uploadsContract", harnessParams: (f) => ({ uploads: f.uploads }) };
const UPLOAD = { id: "avatar", maxBytes: 5242880, accept: ["image/jpeg", "image/png"], cancel: "required", retry: "required" };
const FACTS = { uploads: [UPLOAD], hasHarness: true, harnessKind: "node-adapter" };

test("T23.2 la implementación correcta pasa; la traza no lleva nombres de archivo", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.equal(trace.scenarios.length, 6);
  assert.ok(!JSON.stringify(trace).includes("archivo-sintetico"));
});

const MATRIX = {
  "no-size-check": ["message-text", "size-limit"],
  "no-type-check": ["message-text", "type-check"],
  "raw-keys": ["message-text"],
  "no-progress": ["progress"],
  "no-cancel": ["cancel"],
  "no-error-state": ["error-state", "retry"],
  "no-retry": ["retry"],
  "double-start": ["duplicate-upload"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T23.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T23.2 sin cancelar ni reintentar exigidos, y con */*, esos escenarios no corren", async () => {
  const r = await runControl(SPEC, "no-cancel", { ...FACTS, uploads: [{ ...UPLOAD, accept: ["*/*"], cancel: "not-applicable", retry: "not-applicable" }] }, { params: { allowAnyType: true } });
  assert.deepEqual(r.trace.scenarios.map((s) => s.id.split("@")[0]), ["accept", "too-large", "network-error", "double-start"]);
  assert.equal(r.result.decision, "allow");
});

test("T23.1 contrato: tamaño por encima del límite y */* sin permiso son deterministas", () => {
  const obs = [{ kind: "uploads-contract", observationId: "c", facts: { declared: true, valid: true, errorCodes: [], contract: { ...FACTS, uploads: [{ ...UPLOAD, maxBytes: 2147483648, accept: ["*/*"] }] } } }];
  assert.deepEqual(evaluateWith(SPEC, obs).findings.map((f) => f.fingerprint).sort(), ["ufu:contract-accept-any:avatar", "ufu:contract-size:avatar"]);
});
