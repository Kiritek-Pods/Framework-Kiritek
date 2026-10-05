"use strict";

/**
 * Tarea 39 — Pack GitHub ENDURECIDO (fase P, providers).
 *
 * Valida los subtareas 39.1–39.6 sobre el generador de plan `github.js`, sus
 * plantillas (`templates/providers/github/**`) y su linter de workflows:
 *
 *   39.1 Ruleset preferido O branch protection equivalente (PR, reviews, checks,
 *        resolución de conversaciones, sin force-push/sin borrado) con fallback.
 *   39.2 Actions con SHA inmutable, permisos mínimos, forks seguros e invocando
 *        comandos core (nunca reimplementa detección).
 *   39.3 CODEOWNERS para políticas, workflows, hooks, allowlists y config.
 *   39.4 Observa/planifica secret scanning + push protection; reporta
 *        `unavailable` honestamente SIN reemplazar Gitleaks.
 *   39.5 Diferencia `unauthorized` de `not-configured`; produce comandos/diff,
 *        sin afirmar éxito ni ejecutar cambios remotos.
 *   39.6 Snapshots/schema de ruleset+fallback, linter SHA/permisos/forks, mocks
 *        403/404/capability y smoke `--provider=github` aislado (sin red).
 *
 * Sin red real ni secretos reales: transporte de observación sintético inyectado
 * y marcadores sintéticos únicamente.
 *
 * (Requisitos 17.1–17.7, 15.6, 24.6, 26.9, 28.2, G.8–G.9.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = require("../../src/providers/base.js");
const providers = require("../../src/providers/index.js");
const github = require("../../src/providers/github.js");
const { lintWorkflow } = require("../../src/providers/github-workflow-lint.js");
const { validateAgainst } = require("../../src/domain/schema-validator.js");
const { findCanaries } = require("../../src/scanners/redactor.js");
const securityCli = require("../../src/security-cli.js");

const FIXED_DEPS = {
  clock: () => "2026-10-01T12:00:00.000Z",
  idGenerator: () => "plan-github-fixed",
};

const TPL = path.join(__dirname, "..", "..", "templates", "providers", "github");

function buildGithubPlan(input) {
  return base.buildPlan(github.generate(input || {}), FIXED_DEPS);
}

function changeById(plan, id) {
  return plan.changes.find((c) => c.id === id);
}

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-gh-pack-"));
}

// ── 39.1 Ruleset preferido + branch protection equivalente ───────────────────

test("39.1 el plan incluye ruleset preferido y branch protection de fallback", () => {
  const plan = buildGithubPlan({ env: {} });
  const kinds = plan.changes.map((c) => c.kind);
  assert.ok(kinds.includes("ruleset"), "falta el ruleset preferido");
  assert.ok(kinds.includes("branch-protection"), "falta el fallback de branch protection");

  const ruleset = changeById(plan, "ruleset-default-branch");
  assert.equal(ruleset.kind, "ruleset");
  assert.match(ruleset.description, /PREFERIDO/);
  assert.match(ruleset.description, /PR/);
  assert.match(ruleset.description, /review/i);
  assert.match(ruleset.description, /conversaciones/i);
  assert.match(ruleset.description, /force-push|non_fast_forward/i);
  assert.match(ruleset.description, /borrado|deletion/i);

  const fallback = changeById(plan, "branch-protection-fallback");
  assert.match(fallback.description, /FALLBACK/);
});

test("39.1 la rama default se resuelve desde la config (no asume main)", () => {
  const plan = buildGithubPlan({ env: {}, config: { defaultBranch: { explicit: "trunk" } } });
  const ruleset = changeById(plan, "ruleset-default-branch");
  assert.equal(ruleset.target, "branch:trunk");
  const dbParam = plan.parameters.find((p) => p.name === "defaultBranch");
  assert.equal(dbParam.resolved, "trunk");
  assert.equal(dbParam.source, "config");
});

test("39.1 reviews mínimas configurables (default 1)", () => {
  const def = buildGithubPlan({ env: {} });
  assert.equal(def.parameters.find((p) => p.name === "requiredReviews").resolved, 1);
  const cfg = buildGithubPlan({ env: {}, config: { github: { requiredReviews: 2 } } });
  assert.equal(cfg.parameters.find((p) => p.name === "requiredReviews").resolved, 2);
  assert.match(changeById(cfg, "ruleset-default-branch").description, /2 review/);
});

// ── 39.1/39.6 Snapshot + schema del ruleset y del fallback ────────────────────

test("39.6 ruleset.json es JSON válido y modela PR/checks/sin-force/sin-delete", () => {
  const rs = JSON.parse(fs.readFileSync(path.join(TPL, "ruleset.json"), "utf8"));
  assert.equal(rs.target, "branch");
  const types = rs.rules.map((r) => r.type);
  assert.ok(types.includes("pull_request"));
  assert.ok(types.includes("required_status_checks"));
  assert.ok(types.includes("non_fast_forward"), "debe bloquear force-push");
  assert.ok(types.includes("deletion"), "debe bloquear borrado de rama");
  const pr = rs.rules.find((r) => r.type === "pull_request");
  assert.equal(pr.parameters.required_review_thread_resolution, true);
  assert.equal(pr.parameters.require_code_owner_review, true);
});

test("39.6 branch-protection.json (fallback) es equivalente al ruleset", () => {
  const bp = JSON.parse(fs.readFileSync(path.join(TPL, "branch-protection.json"), "utf8"));
  assert.equal(bp.allow_force_pushes, false);
  assert.equal(bp.allow_deletions, false);
  assert.equal(bp.required_conversation_resolution, true);
  assert.ok(bp.required_pull_request_reviews);
  assert.ok(bp.required_status_checks);
});

// ── 39.2 Actions endurecido ──────────────────────────────────────────────────

test("39.2/39.6 el workflow emitido pasa el linter de endurecimiento", () => {
  const wf = fs.readFileSync(path.join(TPL, "workflows", "kiritek-security.yml"), "utf8");
  const res = lintWorkflow(wf);
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

test("39.2 el workflow fija toda action por SHA de 40 hex", () => {
  const wf = fs.readFileSync(path.join(TPL, "workflows", "kiritek-security.yml"), "utf8");
  const usesLines = wf.split("\n").filter((l) => /uses:/.test(l));
  assert.ok(usesLines.length > 0);
  for (const line of usesLines) {
    const m = line.match(/@(\S+)/);
    assert.ok(m && /^[0-9a-f]{40}$/.test(m[1]), `no fijada por SHA: ${line.trim()}`);
  }
});

test("39.2 el workflow invoca el core y NO reimplementa detección ni usa pull_request_target", () => {
  const wf = fs.readFileSync(path.join(TPL, "workflows", "kiritek-security.yml"), "utf8");
  assert.match(wf, /kiritek-init scan/);
  assert.equal(/pull_request_target/.test(wf), false);
  assert.equal(/git\s+push/.test(wf), false);
});

test("39.6 el linter DETECTA tag mutable, permiso amplio, push y fork inseguro", () => {
  const bad = [
    "name: bad",
    "on: { push: {} }",
    "permissions: write-all",
    "jobs:",
    "  x:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: git push origin main",
  ].join("\n");
  const res = lintWorkflow(bad, { requireCoreCommand: false });
  assert.equal(res.ok, false);
  const codes = res.violations.map((v) => v.code);
  assert.ok(codes.includes("sha-pin"));
  assert.ok(codes.includes("permissions-broad"));
  assert.ok(codes.includes("no-push"));

  const forkBad = [
    "name: fork",
    "on: { pull_request_target: {} }",
    "permissions:",
    "  contents: read",
    "concurrency: { group: x }",
    "jobs:",
    "  x:",
    "    timeout-minutes: 5",
    "    steps:",
    "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    "      - run: npx kiritek-init scan",
  ].join("\n");
  const forkRes = lintWorkflow(forkBad);
  assert.ok(forkRes.violations.some((v) => v.code === "fork-unsafe"));
});

// ── 39.3 CODEOWNERS ──────────────────────────────────────────────────────────

test("39.3 el plan incluye CODEOWNERS y cubre políticas/workflows/hooks/allowlists/config", () => {
  const plan = buildGithubPlan({ env: {} });
  const co = changeById(plan, "codeowners");
  assert.equal(co.kind, "codeowners");
  for (const needle of [".kiritek/", "templates/core/security/", ".github/workflows/", ".kiritek/hooks/", ".gitleaksignore", "kiritek-security.config.json"]) {
    assert.match(co.description, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("39.3 la plantilla CODEOWNERS protege las rutas clave de seguridad", () => {
  const co = fs.readFileSync(path.join(TPL, "CODEOWNERS"), "utf8");
  for (const needle of ["/.kiritek/", "/templates/core/security/", "/.github/workflows/", "/.kiritek/hooks/", "/.gitleaksignore", "/CODEOWNERS"]) {
    assert.ok(co.includes(needle), `CODEOWNERS no protege ${needle}`);
  }
});

// ── 39.4 Secret scanning / push protection sin reemplazar Gitleaks ───────────

test("39.4 sin observación: secret scanning/push protection => unavailable/unknown, nunca activado", () => {
  const plan = buildGithubPlan({ env: {} });
  for (const id of ["secret-scanning", "push-protection"]) {
    const c = changeById(plan, id);
    assert.ok(c, `falta el cambio ${id}`);
    assert.match(c.description, /UNAVAILABLE|UNKNOWN|no autorizado|no configurado/i);
    assert.match(c.description, /Gitleaks/);
    // Nunca afirma que quedó activo.
    assert.equal(/activad[oa]|habilitad[oa] con éxito|success/i.test(c.description), false);
  }
});

test("39.4 observado ACTIVO => noop; observado disponible-no-activo => create", () => {
  const activeTransport = ({ resource }) =>
    resource === "secret-scanning"
      ? { status: base.OBSERVATION.OBSERVED, enabled: true }
      : { httpStatus: 404 };
  const planActive = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: activeTransport }), FIXED_DEPS);
  assert.equal(changeById(planActive, "secret-scanning").action, "noop");

  const availTransport = () => ({ status: base.OBSERVATION.OBSERVED, enabled: false });
  const planAvail = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: availTransport }), FIXED_DEPS);
  assert.equal(changeById(planAvail, "secret-scanning").action, "create");
});

// ── 39.5 unauthorized vs not-configured + comandos/diff ──────────────────────

test("39.5 sin credencial => not-configured; con credencial sin observar => unknown", () => {
  assert.equal(buildGithubPlan({ env: {} }).observation, "not-configured");
  assert.equal(buildGithubPlan({ env: { GITHUB_TOKEN: "synthetic" } }).observation, "unknown");
});

test("39.5 mock 403 => unauthorized (permiso denegado), distinguible de 404 => not-configured", () => {
  const transport403 = () => ({ httpStatus: 403, reason: "forbidden" });
  const plan403 = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: transport403 }), FIXED_DEPS);
  assert.equal(plan403.observation, "unauthorized");
  assert.match(plan403.observationReason, /denegad|permiso/i);
  assert.ok(plan403.requiredPermissions.some((p) => p.status === "unauthorized"));

  const transport404 = () => ({ httpStatus: 404 });
  const plan404 = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: transport404 }), FIXED_DEPS);
  assert.equal(plan404.observation, "not-configured");
  assert.notEqual(plan403.observation, plan404.observation);
});

test("39.5 mock 200 => observed", () => {
  const transport200 = () => ({ httpStatus: 200 });
  const plan = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: transport200 }), FIXED_DEPS);
  assert.equal(plan.observation, "observed");
});

test("39.5 el plan ofrece comandos/diff y rollback, sin afirmar éxito", () => {
  const plan = buildGithubPlan({ env: {} });
  const ruleset = changeById(plan, "ruleset-default-branch");
  assert.match(ruleset.description, /gh api/);
  assert.match(ruleset.description, /requiere confirmaci/i);
  assert.ok(plan.rollback.length >= 1);
  // El contrato base fija que nada se aplicó.
  assert.equal(plan.applied, false);
  assert.equal(plan.apply.supported, false);
});

// ── 39.6 Determinismo, aislamiento, cero-red y smoke CLI ─────────────────────

test("39.6 el plan es determinista (byte-idéntico) para el mismo input", () => {
  const a = buildGithubPlan({ env: {} });
  const b = buildGithubPlan({ env: {} });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("39.6 el plan es schema-valid (provider-plan.schema.json)", () => {
  const plan = buildGithubPlan({ env: { GITHUB_TOKEN: "x" } });
  const check = validateAgainst("provider-plan", JSON.parse(JSON.stringify(plan)));
  assert.equal(check.valid, true, check.errors.join("; "));
});

test("39.6 aislamiento: github.js no importa codecommit ni el instalador del core", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "providers", "github.js"), "utf8");
  assert.equal(/require\(["'][^"']*codecommit/.test(src), false);
  assert.equal(/require\(["'][^"']*install\//.test(src), false);
  assert.equal(/core-security/.test(src), false);
});

test("39.6 generar el plan (con y sin credencial) NO abre red", () => {
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const calls = [];
  const originals = {
    httpReq: http.request, httpsReq: https.request,
    httpGet: http.get, httpsGet: https.get,
    connect: net.Socket.prototype.connect,
  };
  http.request = () => { calls.push("http.request"); throw new Error("red prohibida"); };
  https.request = () => { calls.push("https.request"); throw new Error("red prohibida"); };
  http.get = () => { calls.push("http.get"); throw new Error("red prohibida"); };
  https.get = () => { calls.push("https.get"); throw new Error("red prohibida"); };
  net.Socket.prototype.connect = function () { calls.push("socket.connect"); throw new Error("red prohibida"); };
  try {
    buildGithubPlan({ env: {} });
    buildGithubPlan({ env: { GITHUB_TOKEN: "x" } });
  } finally {
    http.request = originals.httpReq;
    https.request = originals.httpsReq;
    http.get = originals.httpGet;
    https.get = originals.httpsGet;
    net.Socket.prototype.connect = originals.connect;
  }
  assert.deepEqual(calls, []);
});

test("39.6 smoke CLI `provider plan github` aislado: exit 0, schema-valid, sin canario", () => {
  const repo = tmpRepo();
  try {
    let out = "";
    const code = securityCli.run(["provider", "plan", "github"], {
      cwd: repo,
      env: { GITHUB_TOKEN: "ghp_000000000000000000000000000000000000" },
      stdout: { write: (s) => { out += s; } },
      stderr: { write: () => {} },
      now: () => Date.parse("2026-10-01T12:00:00.000Z"),
      idGenerator: () => "plan-cli-github",
    });
    assert.equal(code, 0);
    const json = JSON.parse(out);
    assert.equal(json.provider, "github");
    assert.equal(validateAgainst("provider-plan", json.plan).valid, true);
    assert.ok(json.plan.changes.length >= 5, "el plan endurecido debe describir varios cambios");
    // Redacción: el valor del token nunca aparece; sólo su presencia.
    assert.equal(findCanaries(out).length, 0);
    assert.equal(out.includes("ghp_000000000000000000000000000000000000"), false);
    assert.equal(json.plan.parameters.find((p) => p.name === "credentialPresent").resolved, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
