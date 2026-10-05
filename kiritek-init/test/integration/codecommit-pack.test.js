"use strict";

/**
 * Tarea 40 — Pack AWS CodeCommit ENDURECIDO (fase P, providers).
 *
 * Valida los subtareas 40.1–40.7 sobre el generador de plan `codecommit.js`,
 * sus plantillas (`templates/providers/aws-codecommit/**`) y su linter IAM/IaC:
 *
 *   40.1 IaC/plan IAM de MÍNIMO PRIVILEGIO para operaciones destructivas/sobre
 *        la rama default, por rol, con parámetros por entorno y rollback.
 *   40.2 Approval rule template: revisores mínimos, separación de funciones y
 *        prevención de autoaprobación donde AWS lo permite.
 *   40.3 CodeBuild/CodePipeline con gates core, artefactos redactados y
 *        aprobación MANUAL antes de producción.
 *   40.4 SNS/EventBridge sin secretos; preferencia por roles/credenciales
 *        temporales; rotación/revocación; detección de claves obsoletas redactada.
 *   40.5 Repetir la limitación: IAM sobre la rama default NO impide que un
 *        secreto llegue a una feature branch; mantener local/pre-push/CI.
 *   40.6 No aplicar cloud: dry-run/plan; cualquier mutación requiere confirmación
 *        explícita fuera de la tarea.
 *   40.7 Análisis estático IAM/IaC, snapshots por entorno, least privilege,
 *        pipeline/approval/alertas, ausencia de secretos y smoke
 *        `--provider=aws-codecommit` aislado sin llamadas mutantes.
 *
 * Sin red real ni secretos reales: transporte de observación sintético inyectado
 * y marcadores sintéticos únicamente.
 *
 * (Requisitos 16.1–16.8, 19.3, 24.6, 26.9, 27.4, G.9–G.10.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = require("../../src/providers/base.js");
const providers = require("../../src/providers/index.js");
const codecommit = require("../../src/providers/codecommit.js");
const iamLint = require("../../src/providers/codecommit-iam-lint.js");
const { validateAgainst } = require("../../src/domain/schema-validator.js");
const { findCanaries } = require("../../src/scanners/redactor.js");
const securityCli = require("../../src/security-cli.js");

const FIXED_DEPS = {
  clock: () => "2026-10-01T12:00:00.000Z",
  idGenerator: () => "plan-codecommit-fixed",
};

const TPL = path.join(__dirname, "..", "..", "templates", "providers", "aws-codecommit");

function buildCcPlan(input) {
  return base.buildPlan(codecommit.generate(input || {}), FIXED_DEPS);
}

function changeById(plan, id) {
  return plan.changes.find((c) => c.id === id);
}

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-cc-pack-"));
}

// ── 40.1 IAM de mínimo privilegio: cambios del plan + parámetros por entorno ──

test("40.1 el plan incluye un cambio IAM de mínimo privilegio sobre la rama default", () => {
  const plan = buildCcPlan({ env: {} });
  const kinds = plan.changes.map((c) => c.kind);
  assert.ok(kinds.includes("iam"), "falta el cambio IAM");

  const iam = changeById(plan, "iam-least-privilege-default-branch");
  assert.equal(iam.kind, "iam");
  assert.match(iam.description, /MÍNIMO PRIVILEGIO/);
  assert.match(iam.description, /rama default|branch/i);
  assert.match(iam.description, /nunca Resource:\*|Resource:\*|admin \*:\*/i);
  // Las acciones destructivas se nombran explícitamente.
  for (const action of codecommit.DESTRUCTIVE_ACTIONS) {
    assert.match(iam.description, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("40.1 parámetros por entorno (no asume main, entorno configurable) y rollback", () => {
  const def = buildCcPlan({ env: {} });
  assert.equal(def.parameters.find((p) => p.name === "defaultBranch").resolved, "main");
  assert.equal(def.parameters.find((p) => p.name === "environment").resolved, "prod");

  const cfg = buildCcPlan({
    env: {},
    config: { defaultBranch: { explicit: "trunk" }, codecommit: { environment: "staging", repository: "svc-api" } },
  });
  const db = cfg.parameters.find((p) => p.name === "defaultBranch");
  assert.equal(db.resolved, "trunk");
  assert.equal(db.source, "config");
  const envp = cfg.parameters.find((p) => p.name === "environment");
  assert.equal(envp.resolved, "staging");
  assert.equal(envp.source, "config");
  // El cambio IAM refleja la rama/entorno/repo resueltos.
  const iam = changeById(cfg, "iam-least-privilege-default-branch");
  assert.match(iam.target, /svc-api/);
  assert.match(iam.target, /branch\/trunk/);
  assert.match(iam.target, /staging/);
  // Rollback presente para el stack IAM.
  assert.ok(cfg.rollback.some((r) => r.id === "rollback-iam"));
});

test("40.7 la plantilla IAM pasa el análisis estático de MÍNIMO PRIVILEGIO", () => {
  const text = fs.readFileSync(path.join(TPL, "iam-least-privilege.yaml"), "utf8");
  const res = iamLint.lintTemplateText(text, { requirePolicy: true, requireRestriction: true });
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

test("40.7 el linter IAM DETECTA admin *:*, comodín de servicio y Resource:* destructivo", () => {
  const admin = iamLint.lintPolicyDocument({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["*:*"], Resource: "*" }],
  });
  assert.equal(admin.ok, false);
  assert.ok(admin.violations.some((v) => v.code === "admin-wildcard"));

  const svc = iamLint.lintPolicyDocument({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["codecommit:*"], Resource: "arn:aws:codecommit:*:*:repo" }],
  });
  assert.ok(svc.violations.some((v) => v.code === "service-wildcard"));

  const destr = iamLint.lintPolicyDocument({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["codecommit:DeleteBranch"], Resource: "*" }],
  });
  assert.ok(destr.violations.some((v) => v.code === "destructive-resource-star"));
});

test("40.7 el linter IAM también DETECTA problemas en texto YAML CFN", () => {
  const badYaml = [
    "Statement:",
    "  - Effect: Allow",
    "    Action:",
    '      - "*:*"',
    "    Resource: arn:aws:codecommit:*:*:repo",
  ].join("\n");
  const res = iamLint.lintTemplateText(badYaml);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === "admin-wildcard"));
});

// ── 40.2 Approval rule template ──────────────────────────────────────────────

test("40.2 el plan describe approval rule con revisores mínimos y separación de funciones", () => {
  const plan = buildCcPlan({ env: {}, config: { codecommit: { minReviewers: 3 } } });
  const ar = changeById(plan, "approval-rule-default-branch");
  assert.equal(ar.kind, "approval-rule");
  assert.match(ar.description, /3 revisor/);
  assert.match(ar.description, /SEPARACIÓN DE FUNCIONES/);
  assert.match(ar.description, /AUTOAPROBACIÓN/);
  assert.equal(plan.parameters.find((p) => p.name === "minReviewers").resolved, 3);
});

test("40.2 la plantilla approval-rule-template.json es válida y modela el pool por rol", () => {
  const raw = fs.readFileSync(path.join(TPL, "approval-rule-template.json"), "utf8");
  const art = JSON.parse(raw);
  assert.equal(art.Version, "2018-11-08");
  assert.ok(art.DestinationReferences.some((r) => r.includes("{{DEFAULT_BRANCH}}")));
  const stmt = art.Statements[0];
  assert.equal(stmt.Type, "Approvers");
  // El pool se restringe a un rol release (distinto del autor): separación.
  assert.ok(stmt.ApprovalPoolMembers.some((m) => m.includes("kiritek-codecommit-release")));
});

// ── 40.3 CodeBuild/CodePipeline con gates core + aprobación manual ───────────

test("40.3 el plan describe un pipeline con gate core y aprobación manual antes de prod", () => {
  const plan = buildCcPlan({ env: {} });
  const pipe = changeById(plan, "pipeline-core-gates");
  assert.equal(pipe.kind, "pipeline");
  assert.match(pipe.description, /kiritek-init scan/);
  assert.match(pipe.description, /REDACTAD/i);
  assert.match(pipe.description, /APROBACIÓN MANUAL/);
  assert.match(pipe.description, /producción/);
  assert.match(pipe.description, /NO reimplementa/i);
});

test("40.3 la plantilla codepipeline invoca el core, redacta artefactos y exige aprobación manual", () => {
  const wf = fs.readFileSync(path.join(TPL, "codepipeline.yaml"), "utf8");
  assert.match(wf, /npx kiritek-init scan/);
  assert.match(wf, /Provider: Manual/);
  assert.match(wf, /report\.json/);
  // No reimplementa detección: no hay otra herramienta de escaneo embebida.
  assert.equal(/gitleaks (?!del core)/i.test(wf), false);
  // Pasa el linter (rol de build de mínimo privilegio, sin admin).
  assert.equal(iamLint.lintTemplateText(wf).ok, true);
});

// ── 40.4 SNS/EventBridge sin secretos + rotación + detección redactada ───────

test("40.4 el plan describe alertas SNS/EventBridge sin secretos y preferencia por roles", () => {
  const plan = buildCcPlan({ env: {} });
  const n = changeById(plan, "notifications-sns-eventbridge");
  assert.equal(n.kind, "notification");
  assert.match(n.description, /SIN secretos/i);
  assert.match(n.description, /EventBridge/);
  assert.match(n.description, /SNS/);
  assert.match(n.description, /roles\/credenciales temporales|STS/i);
  assert.match(n.description, /ROTACIÓN\/REVOCACIÓN|rotaci/i);
});

test("40.4 detección de clave de larga duración es REDACTADA (presencia, nunca valor)", () => {
  // Clave de larga duración sintética (AKIA...): el valor nunca debe aparecer.
  const withStatic = buildCcPlan({
    env: { AWS_ACCESS_KEY_ID: "AKIAZZZZZZZZZZZZZZZZ", AWS_SECRET_ACCESS_KEY: "x".repeat(40) },
  });
  assert.equal(withStatic.parameters.find((p) => p.name === "staticAccessKeyPresent").resolved, true);
  assert.equal(withStatic.parameters.find((p) => p.name === "temporaryCredential").resolved, false);
  const n = changeById(withStatic, "notifications-sns-eventbridge");
  assert.match(n.description, /LARGA DURACIÓN/i);
  assert.match(n.description, /ROTACIÓN\/REVOCACIÓN/i);
  // El valor de la clave jamás aparece en el plan serializado.
  const serialized = JSON.stringify(withStatic);
  assert.equal(serialized.includes("AKIAZZZZZZZZZZZZZZZZ"), false);
  assert.equal(findCanaries(serialized).length, 0);

  // Credenciales temporales (preferidas): no se marca clave estática.
  const temp = buildCcPlan({ env: { AWS_PROFILE: "ci", AWS_SESSION_TOKEN: "synthetic-session" } });
  assert.equal(temp.parameters.find((p) => p.name === "temporaryCredential").resolved, true);
  assert.equal(temp.parameters.find((p) => p.name === "staticAccessKeyPresent").resolved, false);
});

test("40.4 la plantilla SNS/EventBridge no incrusta secretos", () => {
  const text = fs.readFileSync(path.join(TPL, "sns-eventbridge.yaml"), "utf8");
  assert.equal(iamLint.lintTemplateText(text).ok, true);
  assert.equal(findCanaries(text).length, 0);
});

// ── 40.5 Limitación default-branch vs feature branch (repetida) ──────────────

test("40.5 el plan REPITE la limitación en varios cambios y en un cambio propio", () => {
  const plan = buildCcPlan({ env: {} });
  const limitation = changeById(plan, "limitation-default-branch-vs-feature");
  assert.ok(limitation, "falta el cambio de limitación explícita");
  assert.match(limitation.description, /feature branch/i);
  assert.match(limitation.description, /local|pre-push|CI/i);

  // La limitación aparece también en IAM, approval y plan.reason.
  assert.match(changeById(plan, "iam-least-privilege-default-branch").description, /feature branch/i);
  assert.match(changeById(plan, "approval-rule-default-branch").description, /feature branch/i);
  assert.match(plan.reason, /feature branch/i);
});

test("40.5 el documento LIMITATIONS.md repite la limitación verbatim-en-espíritu", () => {
  const doc = fs.readFileSync(path.join(TPL, "LIMITATIONS.md"), "utf8");
  assert.match(doc, /NO protege las feature branches/i);
  assert.match(doc, /impiden que un\s+secreto llegue a una feature branch/i);
  assert.match(doc, /pre-push/);
  assert.match(doc, /CI/);
  assert.match(doc, /Gitleaks/);
});

// ── 40.6 No aplicar cloud (dry-run) ──────────────────────────────────────────

test("40.6 el plan es dry-run, no aplicado y exige confirmación humana fuera del plan", () => {
  const plan = buildCcPlan({ env: {} });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.applied, false);
  assert.equal(plan.apply.supported, false);
  assert.equal(plan.apply.requiresHumanConfirmation, true);
  // Los comandos de aplicación son DESCRIPCIONES; exigen confirmación.
  assert.match(changeById(plan, "iam-least-privilege-default-branch").description, /requiere confirmaci/i);
});

test("40.6 el generador NO expone ninguna ruta de apply/execute/mutate", () => {
  for (const forbidden of ["apply", "execute", "mutate", "deploy"]) {
    assert.equal(typeof codecommit[forbidden], "undefined", `codecommit no debe exportar ${forbidden}`);
  }
});

// ── 40.7 Determinismo, aislamiento, cero-red, estados y smoke CLI ────────────

test("40.7 el plan es determinista (byte-idéntico) para el mismo input", () => {
  const a = buildCcPlan({ env: {} });
  const b = buildCcPlan({ env: {} });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("40.7 el plan es schema-valid (provider-plan.schema.json)", () => {
  const plan = buildCcPlan({ env: { AWS_PROFILE: "x" } });
  const check = validateAgainst("provider-plan", JSON.parse(JSON.stringify(plan)));
  assert.equal(check.valid, true, check.errors.join("; "));
});

test("40.7 estados: sin credencial => not-configured; con credencial sin observar => unknown", () => {
  assert.equal(buildCcPlan({ env: {} }).observation, "not-configured");
  assert.equal(buildCcPlan({ env: { AWS_PROFILE: "x" } }).observation, "unknown");
});

test("40.7 mock 403 => unauthorized, distinguible de 404 => not-configured y 200 => observed", () => {
  const t403 = () => ({ httpStatus: 403, reason: "denied" });
  const p403 = base.buildPlan(codecommit.generate({ env: { AWS_PROFILE: "x" }, observe: t403 }), FIXED_DEPS);
  assert.equal(p403.observation, "unauthorized");
  assert.match(p403.observationReason, /denegad|permiso/i);
  assert.ok(p403.requiredPermissions.some((p) => p.status === "unauthorized"));

  const t404 = () => ({ httpStatus: 404 });
  const p404 = base.buildPlan(codecommit.generate({ env: { AWS_PROFILE: "x" }, observe: t404 }), FIXED_DEPS);
  assert.equal(p404.observation, "not-configured");
  assert.notEqual(p403.observation, p404.observation);

  const t200 = () => ({ httpStatus: 200 });
  const p200 = base.buildPlan(codecommit.generate({ env: { AWS_PROFILE: "x" }, observe: t200 }), FIXED_DEPS);
  assert.equal(p200.observation, "observed");
});

test("40.7 observado ACTIVO => pipeline/notification noop; sin observar => create", () => {
  const activeTransport = ({ resource }) =>
    resource === "codepipeline" ? { status: base.OBSERVATION.OBSERVED, enabled: true } : { httpStatus: 404 };
  const planActive = base.buildPlan(
    codecommit.generate({ env: { AWS_PROFILE: "x" }, observe: activeTransport }),
    FIXED_DEPS
  );
  assert.equal(changeById(planActive, "pipeline-core-gates").action, "noop");

  const planDefault = buildCcPlan({ env: {} });
  assert.equal(changeById(planDefault, "pipeline-core-gates").action, "create");
});

test("40.7 aislamiento: codecommit.js no importa github ni el instalador del core", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "providers", "codecommit.js"), "utf8");
  assert.equal(/require\(["'][^"']*github/.test(src), false);
  assert.equal(/require\(["'][^"']*install\//.test(src), false);
  assert.equal(/core-security/.test(src), false);
});

test("40.7 generar el plan (con y sin credencial) NO abre red", () => {
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
    buildCcPlan({ env: {} });
    buildCcPlan({ env: { AWS_ACCESS_KEY_ID: "AKIAZZZZZZZZZZZZZZZZ", AWS_SECRET_ACCESS_KEY: "x".repeat(40) } });
  } finally {
    http.request = originals.httpReq;
    https.request = originals.httpsReq;
    http.get = originals.httpGet;
    https.get = originals.httpsGet;
    net.Socket.prototype.connect = originals.connect;
  }
  assert.deepEqual(calls, []);
});

test("40.7 smoke CLI `provider plan aws-codecommit` aislado: exit 0, schema-valid, sin canario, sin mutar", () => {
  const repo = tmpRepo();
  try {
    let out = "";
    const code = securityCli.run(["provider", "plan", "aws-codecommit"], {
      cwd: repo,
      // Credencial de larga duración sintética: su VALOR nunca debe aparecer.
      env: { AWS_ACCESS_KEY_ID: "AKIAZZZZZZZZZZZZZZZZ", AWS_SECRET_ACCESS_KEY: "y".repeat(40) },
      stdout: { write: (s) => { out += s; } },
      stderr: { write: () => {} },
      now: () => Date.parse("2026-10-01T12:00:00.000Z"),
      idGenerator: () => "plan-cli-codecommit",
    });
    assert.equal(code, 0);
    const json = JSON.parse(out);
    assert.equal(json.provider, "aws-codecommit");
    assert.equal(validateAgainst("provider-plan", json.plan).valid, true);
    assert.ok(json.plan.changes.length >= 5, "el plan endurecido debe describir varios cambios");
    // Redacción: el valor de la clave nunca aparece; sólo su presencia.
    assert.equal(findCanaries(out).length, 0);
    assert.equal(out.includes("AKIAZZZZZZZZZZZZZZZZ"), false);
    assert.equal(json.plan.parameters.find((p) => p.name === "credentialPresent").resolved, true);
    assert.equal(json.plan.parameters.find((p) => p.name === "staticAccessKeyPresent").resolved, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
