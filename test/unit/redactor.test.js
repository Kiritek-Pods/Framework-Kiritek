"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const redactor = require("../../src/scanners/redactor.js");

test("redact: reemplaza campos sensibles por el marcador", () => {
  const out = redactor.redact({
    controlId: "c",
    secret: "AKIAABCDEFGHIJKLMNOP",
    nested: { token: "ghp_" + "a".repeat(36), ok: "visible" },
  });
  assert.equal(out.secret, redactor.REDACTED);
  assert.equal(out.nested.token, redactor.REDACTED);
  assert.equal(out.nested.ok, "visible");
});

test("sanitizeUrl: elimina user:pass@ y query sensibles", () => {
  assert.equal(
    redactor.sanitizeUrl("https://user:p4ss@host.com/path"),
    "https://[REDACTED]@host.com/path"
  );
  const q = redactor.sanitizeUrl("https://api.host/x?access_token=supersecret&page=2");
  assert.ok(q.includes("access_token=[REDACTED]"));
  assert.ok(q.includes("page=2"));
});

test("sanitizeText: redacta Authorization y URLs embebidas", () => {
  const t = redactor.sanitizeText("Authorization: Bearer abc.def.ghi llamando a https://u:pw@h/x");
  assert.ok(/Bearer \[REDACTED\]/.test(t));
  assert.ok(/\[REDACTED\]@h/.test(t));
});

test("findCanaries: detecta patrones de credenciales reales", () => {
  assert.deepEqual(redactor.findCanaries("prefijo AKIA" + "ABCDEFGHIJKLMNOP suffix"), ["aws-access-key"]);
  assert.equal(redactor.findCanaries("sin secretos aquí").length, 0);
});

test("safeSerialize: bloquea cuando un canario sobrevive a la redacción", () => {
  // Un canario en una CLAVE (no en los SENSITIVE_FIELDS ni como URL) sobrevive
  // a la redacción por campos y debe hacer fallar la serialización.
  const payload = {};
  payload["AKIA" + "ABCDEFGHIJKLMNOP"] = "x"; // canario en el nombre de la propiedad
  assert.throws(() => redactor.safeSerialize(payload), (err) => {
    assert.equal(err.code, "REDACTION_FAILED");
    assert.ok(err.canaries.includes("aws-access-key"));
    return true;
  });
});

test("safeSerialize: pasa cuando los campos sensibles están redactados", () => {
  const { json } = redactor.safeSerialize({
    controlId: "c",
    secret: "AKIA" + "ABCDEFGHIJKLMNOP",
  });
  assert.ok(json.includes("[REDACTED]"));
  assert.equal(redactor.findCanaries(json).length, 0);
});

test("fuzz: ningún secreto en campo sensible sobrevive a safeSerialize", () => {
  const generators = [
    () => "AKIA" + randomUpper(16),
    () => "ghp_" + randomAlnum(36),
    () => "xoxb-" + randomAlnum(20),
    () => "-----BEGIN PRIVATE KEY-----\n" + randomAlnum(40) + "\n-----END PRIVATE KEY-----",
  ];
  for (let i = 0; i < 200; i += 1) {
    const gen = generators[i % generators.length];
    const value = gen();
    const { json } = redactor.safeSerialize({ secret: value, match: value, token: value });
    assert.equal(redactor.findCanaries(json).length, 0, `fuzz #${i}: canario sobrevivió`);
    assert.equal(json.includes(value), false, `fuzz #${i}: valor en claro en la salida`);
  }
});

function randomUpper(n) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return pick(alpha, n);
}
function randomAlnum(n) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return pick(alpha, n);
}
function pick(alpha, n) {
  const bytes = crypto.randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i += 1) out += alpha[bytes[i] % alpha.length];
  return out;
}
