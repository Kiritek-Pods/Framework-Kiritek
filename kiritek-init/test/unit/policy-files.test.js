"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const files = require("../../src/policy/files.js");
const engine = require("../../src/policy/engine.js");
const { createException } = require("../../src/domain/exception.js");

const FIXED = "2026-10-01T12:00:00.000Z";
const now = () => Date.parse(FIXED);

// Un "secreto sintético" con forma realista pero no funcional (canario AWS).
const SYNTHETIC_AWS = "AKIA" + "ABCDEFGHIJKLMNOP";

// --- classifyPath ---

test("classifyPath: categoriza rutas sensibles conocidas", () => {
  assert.equal(files.classifyPath(".env").category, files.CATEGORY.ENV);
  assert.equal(files.classifyPath("config/.env.production").category, files.CATEGORY.ENV);
  assert.equal(files.classifyPath("certs/server.pem").category, files.CATEGORY.PRIVATE_KEY);
  assert.equal(files.classifyPath("id_rsa.key").category, files.CATEGORY.CERT_KEY);
  assert.equal(files.classifyPath("credentials.json").category, files.CATEGORY.CREDENTIALS);
  assert.equal(files.classifyPath("secrets/token.txt").category, files.CATEGORY.SECRETS_DIR);
  assert.equal(files.classifyPath("src/app.js").category, files.CATEGORY.NONE);
});

test("classifyPath: .env.example se trata como ejemplo", () => {
  const c = files.classifyPath(".env.example");
  assert.equal(c.isExample, true);
  assert.equal(c.category, files.CATEGORY.EXAMPLE);
});

// --- placeholders ---

test("isPlaceholderOnly: valores placeholder son seguros", () => {
  const content = "API_KEY=YOUR_API_KEY\nTOKEN=<REPLACE_ME>\nURL=https://example.com\n";
  assert.equal(files.isPlaceholderOnly(content), true);
});

test("isPlaceholderOnly: secreto real no es placeholder", () => {
  const content = `AWS_ACCESS_KEY_ID=${SYNTHETIC_AWS}\n`;
  assert.equal(files.isPlaceholderOnly(content), false);
});

// --- evaluateFile: la allowlist por ruta no anula el contenido ---

test("evaluateFile: .env.example con placeholders NO es sensible", () => {
  const r = files.evaluateFile(".env.example", "API_KEY=YOUR_API_KEY\n");
  assert.equal(r.sensitive, false);
});

test("evaluateFile: .env.example con secreto real SÍ es sensible", () => {
  const r = files.evaluateFile(".env.example", `API_KEY=${SYNTHETIC_AWS}\n`);
  assert.equal(r.sensitive, true);
  assert.equal(r.contentHasSecret, true);
});

test("evaluateFile: .env real es sensible por ruta aunque no se vea el contenido", () => {
  const r = files.evaluateFile(".env");
  assert.equal(r.sensitive, true);
});

// --- motor: modo y decisiones ---

test("engine: enforce deniega archivos sensibles", () => {
  const res = engine.evaluateFiles({ event: "pre-commit", mode: "enforce", files: [{ path: ".env", content: "DB=x" }] });
  assert.equal(res.decision, "deny");
  assert.ok(res.findings.length >= 1);
});

test("engine: warning sólo advierte", () => {
  const res = engine.evaluateFiles({ event: "pre-commit", mode: "warning", files: [{ path: ".env" }] });
  assert.equal(res.decision, "warn");
});

test("engine: archivo no sensible → allow", () => {
  const res = engine.evaluateFiles({ event: "pre-commit", mode: "enforce", files: [{ path: "src/app.js", content: "const x=1" }] });
  assert.equal(res.decision, "allow");
});

test("engine: el resultado nunca contiene el valor del secreto", () => {
  const res = engine.evaluateFiles({
    event: "pre-commit",
    mode: "enforce",
    files: [{ path: ".env", content: `KEY=${SYNTHETIC_AWS}` }],
  });
  const serialized = JSON.stringify(res);
  assert.equal(serialized.includes(SYNTHETIC_AWS), false);
  // Debe traer ruta y remediación.
  assert.ok(res.findings[0].path === ".env");
  assert.ok(res.remediation && res.remediation.length > 0);
});

// --- excepciones ---

test("engine: excepción vigente por fingerprint suprime el hallazgo", () => {
  const input = { event: "pre-commit", mode: "enforce", files: [{ path: "secrets/token.txt" }] };
  // Primero obtener el fingerprint que generaría el motor.
  const base = engine.evaluateFiles(input);
  const fp = base.findings[0].fingerprint;
  const exc = createException(
    {
      controlId: engine.CONTROL_ID,
      scopeFingerprint: fp,
      reason: "falso positivo revisado",
      owner: "sec",
      ticket: "SEC-1",
      expiresAt: "2026-10-15T12:00:00.000Z",
    },
    { clock: () => FIXED }
  );
  const res = engine.evaluateFiles(input, { exceptions: [exc], now });
  assert.equal(res.decision, "allow");
});

test("engine: excepción expirada no suprime", () => {
  const input = { event: "pre-commit", mode: "enforce", files: [{ path: "secrets/token.txt" }] };
  const fp = engine.evaluateFiles(input).findings[0].fingerprint;
  const exc = createException(
    {
      controlId: engine.CONTROL_ID,
      scopeFingerprint: fp,
      reason: "x",
      owner: "sec",
      ticket: "SEC-1",
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-15T00:00:00.000Z",
    },
    { clock: () => "2026-09-01T00:00:00.000Z" }
  );
  const res = engine.evaluateFiles(input, { exceptions: [exc], now });
  assert.equal(res.decision, "deny");
});

// --- evaluateSafely: error no degrada a allow en enforce ---

test("evaluateSafely: en enforce un error produce decision error, no allow", () => {
  const res = engine.evaluateSafely(() => {
    throw new Error("boom");
  }, "enforce");
  assert.equal(res.decision, "error");
});

test("evaluateSafely: en warning con fallback explícito degrada a warn", () => {
  const res = engine.evaluateSafely(
    () => {
      throw new Error("boom");
    },
    "warning",
    { allowOnError: true }
  );
  assert.equal(res.decision, "warn");
});

// --- normalización de rutas / case ---

test("classifyPath: separador Windows y mayúsculas se normalizan", () => {
  assert.equal(files.classifyPath("config\\.ENV").category !== files.CATEGORY.NONE, true);
  assert.equal(files.classifyPath("SECRETS/x").category, files.CATEGORY.SECRETS_DIR);
});
