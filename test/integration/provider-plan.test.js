"use strict";

/**
 * Tarea 38 — Contrato común de planes de provider SIN autoaplicación.
 *
 * Demuestra las invariantes de la fase P (providers) sobre el contrato base y
 * su cableado al CLI `provider plan`:
 *
 *   38.1 Planes DETERMINISTAS con changes/permisos/parámetros/dry-run/rollback
 *        y estado observed|unauthorized|not-configured|unknown. Un plan es un
 *        artefacto descrito, NO un cambio aplicado.
 *   38.2 Instalación local separada de la observación/aplicación remota; el plan
 *        NUNCA muta estado remoto ni hace una llamada mutante. Cualquier apply
 *        requiere confirmación humana explícita FUERA del plan.
 *   38.3 Selección exclusiva/independiente: el core no instala providers y un
 *        provider no instala al otro (aislamiento de packs).
 *   38.4 Validar: dry-run sin llamadas mutantes, planes schema-valid, permisos
 *        ausentes diferenciados (unauthorized vs not-configured) y snapshots que
 *        demuestren aislamiento.
 *
 * No hay red real ni secretos reales: sólo marcadores sintéticos y presencia de
 * credenciales simulada vía `env`.
 *
 * (Requisitos 15.2, 16.1, 16.8, 17.1, 17.7, 22.6, G.9.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = require("../../src/providers/base.js");
const providers = require("../../src/providers/index.js");
const github = require("../../src/providers/github.js");
const codecommit = require("../../src/providers/codecommit.js");
const { validateAgainst } = require("../../src/domain/schema-validator.js");
const { findCanaries } = require("../../src/scanners/redactor.js");
const securityCli = require("../../src/security-cli.js");

// Deps deterministas: reloj e id fijos → plan byte-idéntico.
const FIXED_DEPS = {
  clock: () => "2026-10-01T12:00:00.000Z",
  idGenerator: () => "plan-fixed-id",
};

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-provider-"));
}

// ── 38.1 Determinismo + forma del plan ──────────────────────────────────────

test("plan: mismo input produce un plan BYTE-idéntico (determinista)", () => {
  for (const name of providers.SUPPORTED) {
    const a = providers.createPlan(name, { env: {} }, FIXED_DEPS);
    const b = providers.createPlan(name, { env: {} }, FIXED_DEPS);
    assert.equal(JSON.stringify(a), JSON.stringify(b), `${name} no es determinista`);
  }
});

test("plan: contiene changes/permisos/parámetros/dry-run/rollback y observación", () => {
  const plan = providers.createPlan("github", { env: {} }, FIXED_DEPS);
  assert.ok(Array.isArray(plan.changes));
  assert.ok(Array.isArray(plan.requiredPermissions));
  assert.ok(Array.isArray(plan.parameters));
  assert.ok(Array.isArray(plan.rollback));
  assert.equal(plan.dryRun, true);
  assert.ok(base.OBSERVATIONS.includes(plan.observation));
});

test("plan: buildPlan exige clock e idGenerator inyectables", () => {
  assert.throws(() => base.buildPlan({ provider: "github", observation: "unknown" }, {}), /clock/);
  assert.throws(
    () => base.buildPlan({ provider: "github", observation: "unknown" }, { clock: () => "2026-10-01T12:00:00.000Z" }),
    /idGenerator/
  );
});

// ── 38.1/38.4 Schema-validez ─────────────────────────────────────────────────

test("plan: ambos providers producen planes schema-valid", () => {
  for (const name of providers.SUPPORTED) {
    const plan = providers.createPlan(name, { env: {} }, FIXED_DEPS);
    const check = validateAgainst("provider-plan", JSON.parse(JSON.stringify(plan)));
    assert.equal(check.valid, true, `${name}: ${check.errors.join("; ")}`);
  }
});

test("schema: provider-plan declara additionalProperties:false en el root", () => {
  const schema = require("../../src/domain/schema-validator.js").loadSchema("provider-plan");
  assert.equal(schema.additionalProperties, false);
});

test("schema: fixture válido pasa; fixtures inválidos (applied/bad-observation) son rechazados", () => {
  const F = path.join(__dirname, "..", "fixtures");
  const ok = JSON.parse(fs.readFileSync(path.join(F, "valid", "provider-plan.github.json"), "utf8"));
  assert.equal(validateAgainst("provider-plan", ok).valid, true);

  const applied = JSON.parse(fs.readFileSync(path.join(F, "invalid", "provider-plan.applied.json"), "utf8"));
  assert.equal(validateAgainst("provider-plan", applied).valid, false);

  const badObs = JSON.parse(fs.readFileSync(path.join(F, "invalid", "provider-plan.bad-observation.json"), "utf8"));
  assert.equal(validateAgainst("provider-plan", badObs).valid, false);
});

// ── 38.2 Sin autoaplicación / sin llamadas mutantes ─────────────────────────

test("no-apply: el plan es dry-run, no aplicado, y exige confirmación humana fuera del plan", () => {
  for (const name of providers.SUPPORTED) {
    const plan = providers.createPlan(name, { env: {} }, FIXED_DEPS);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.applied, false);
    assert.equal(plan.apply.supported, false);
    assert.equal(plan.apply.requiresHumanConfirmation, true);
    assert.match(plan.apply.note, /confirmaci/i);
  }
});

test("no-apply: el contrato base NO expone ninguna ruta de apply/execute/mutate", () => {
  const keys = Object.keys(base);
  for (const forbidden of ["apply", "applyPlan", "execute", "mutate", "commit"]) {
    assert.equal(keys.includes(forbidden), false, `base no debe exportar ${forbidden}`);
  }
  // Y ningún generador expone un método de aplicación.
  for (const gen of [github, codecommit, providers]) {
    for (const forbidden of ["apply", "execute", "mutate"]) {
      assert.equal(typeof gen[forbidden], "undefined");
    }
  }
});

test("dry-run: generar planes de ambos providers no realiza ninguna llamada de red", () => {
  // Si alguien introdujera una llamada mutante real, usaría la red. Interceptamos
  // los puntos de red de Node y afirmamos que NINGUNO se invoca al generar.
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const calls = [];
  const originals = {
    httpReq: http.request,
    httpsReq: https.request,
    httpGet: http.get,
    httpsGet: https.get,
    connect: net.Socket.prototype.connect,
  };
  http.request = () => { calls.push("http.request"); throw new Error("red prohibida en dry-run"); };
  https.request = () => { calls.push("https.request"); throw new Error("red prohibida en dry-run"); };
  http.get = () => { calls.push("http.get"); throw new Error("red prohibida en dry-run"); };
  https.get = () => { calls.push("https.get"); throw new Error("red prohibida en dry-run"); };
  net.Socket.prototype.connect = function () { calls.push("socket.connect"); throw new Error("red prohibida en dry-run"); };
  try {
    for (const name of providers.SUPPORTED) {
      // Con y sin credenciales presentes: ninguna rama abre red.
      providers.createPlan(name, { env: {} }, FIXED_DEPS);
      providers.createPlan(name, { env: { GITHUB_TOKEN: "x", AWS_PROFILE: "y" } }, FIXED_DEPS);
    }
  } finally {
    http.request = originals.httpReq;
    https.request = originals.httpsReq;
    http.get = originals.httpGet;
    https.get = originals.httpsGet;
    net.Socket.prototype.connect = originals.connect;
  }
  assert.deepEqual(calls, [], `se detectaron llamadas de red en dry-run: ${calls.join(", ")}`);
});

// ── 38.4 Diferenciar unauthorized vs not-configured ─────────────────────────

test("estados: sin credenciales → not-configured; con credenciales (sin observar) → unknown", () => {
  const ghNone = providers.createPlan("github", { env: {} }, FIXED_DEPS);
  assert.equal(ghNone.observation, "not-configured");

  const ghCred = providers.createPlan("github", { env: { GITHUB_TOKEN: "synthetic" } }, FIXED_DEPS);
  assert.equal(ghCred.observation, "unknown");

  const awsNone = providers.createPlan("aws-codecommit", { env: {} }, FIXED_DEPS);
  assert.equal(awsNone.observation, "not-configured");

  const awsCred = providers.createPlan(
    "aws-codecommit",
    { env: { AWS_ACCESS_KEY_ID: "AKIA_synthetic", AWS_SECRET_ACCESS_KEY: "synthetic" } },
    FIXED_DEPS
  );
  assert.equal(awsCred.observation, "unknown");
});

test("estados: unauthorized es distinguible de not-configured y observed en el contrato base", () => {
  // El contrato base soporta los cuatro estados; aquí verificamos que buildPlan
  // acepta `unauthorized` como estado válido y distinto, para que los packs
  // 39–40 lo usen cuando un permiso esté presente pero denegado.
  const plan = base.buildPlan(
    {
      provider: "github",
      observation: base.OBSERVATION.UNAUTHORIZED,
      requiredPermissions: [
        { id: "admin", scope: "administration:write", status: base.OBSERVATION.UNAUTHORIZED, reason: "403" },
        { id: "read", scope: "contents:read", status: base.OBSERVATION.NOT_CONFIGURED, reason: "sin cred" },
      ],
    },
    FIXED_DEPS
  );
  assert.equal(plan.observation, "unauthorized");
  const statuses = plan.requiredPermissions.map((p) => p.status).sort();
  assert.deepEqual(statuses, ["not-configured", "unauthorized"]);
  assert.equal(validateAgainst("provider-plan", JSON.parse(JSON.stringify(plan))).valid, true);
});

// ── 38.3 Aislamiento de packs ────────────────────────────────────────────────

test("aislamiento: cada generador reclama SÓLO su provider (snapshot)", () => {
  assert.equal(providers.createPlan("github", { env: {} }, FIXED_DEPS).provider, "github");
  assert.equal(providers.createPlan("aws-codecommit", { env: {} }, FIXED_DEPS).provider, "aws-codecommit");
});

test("aislamiento: los packs no se importan entre sí ni al instalador del core", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", "..", "src", "providers", p), "utf8");
  const gh = read("github.js");
  const aws = read("codecommit.js");
  // Un pack NO debe `require` al otro (los comentarios pueden nombrarlo).
  assert.equal(/require\(["'][^"']*codecommit/.test(gh), false, "github.js no debe require codecommit");
  assert.equal(/require\(["'][^"']*github/.test(aws), false, "codecommit.js no debe require github");
  // Ningún pack importa el instalador del core (un pack no instala nada).
  for (const [n, src] of [["github", gh], ["aws", aws]]) {
    assert.equal(/require\(["'][^"']*install\//.test(src), false, `${n} no debe importar install/`);
    assert.equal(/core-security/.test(src), false, `${n} no debe tocar core-security`);
  }
});

test("aislamiento: el instalador del core NO importa ningún provider", () => {
  const core = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "install", "core-security.js"),
    "utf8"
  );
  assert.equal(/require\(["'][^"']*providers\//.test(core), false, "core no debe importar providers/");
});

// ── Cableado CLI `provider plan` ─────────────────────────────────────────────

function runCapture(argv, { cwd, env } = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  const code = securityCli.run(argv, {
    cwd: cwd || process.cwd(),
    env: env || {},
    stdout,
    stderr,
    now: () => Date.parse("2026-10-01T12:00:00.000Z"),
    idGenerator: () => "plan-cli-fixed",
  });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) { /* multi-línea */ }
  return { code, out, err, json };
}

test("cli: provider plan github produce un plan schema-valid (exit 0)", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["provider", "plan", "github"], { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.provider, "github");
    assert.ok(r.json.plan);
    assert.equal(validateAgainst("provider-plan", r.json.plan).valid, true);
    assert.equal(r.json.plan.dryRun, true);
    assert.equal(r.json.plan.applied, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("cli: provider plan aws-codecommit produce un plan schema-valid (exit 0)", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["provider", "plan", "aws-codecommit"], { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.provider, "aws-codecommit");
    assert.equal(validateAgainst("provider-plan", r.json.plan).valid, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("cli: provider plan determinista para el mismo repo/entorno", () => {
  const repo = tmpRepo();
  try {
    const a = runCapture(["provider", "plan", "github"], { cwd: repo });
    const b = runCapture(["provider", "plan", "github"], { cwd: repo });
    assert.equal(a.out, b.out);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("cli: provider desconocido → exit 2 e INVALID_PROVIDER", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["provider", "plan", "gitlab"], { cwd: repo });
    assert.equal(r.code, 2);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, "INVALID_PROVIDER");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("cli: la salida del plan nunca filtra un canario (redacción obligatoria)", () => {
  const repo = tmpRepo();
  try {
    // Credenciales sintéticas en el entorno; su VALOR nunca debe aparecer.
    const r = runCapture(["provider", "plan", "github"], {
      cwd: repo,
      env: { GITHUB_TOKEN: "ghp_000000000000000000000000000000000000" },
    });
    assert.equal(r.code, 0);
    assert.equal(findCanaries(r.out).length, 0, "la salida filtró un canario");
    assert.equal(r.out.includes("ghp_000000000000000000000000000000000000"), false);
    // Sólo se reporta la PRESENCIA de credencial, no su valor.
    const credParam = r.json.plan.parameters.find((p) => p.name === "credentialPresent");
    assert.equal(credParam.resolved, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
