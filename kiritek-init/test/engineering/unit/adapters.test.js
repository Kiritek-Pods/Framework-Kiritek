"use strict";

// T14: adaptadores de superficie (puros): eventos de agente, Kiro, Claude,
// CI provider-neutral y cobertura declarada.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const A = require("../../../src/engineering/guardrails/adapters/index.js");
const { resolveCatalog } = require("../../../src/engineering/guardrails/catalog/resolve.js");

const REPO = path.resolve("/tmp/kiritek-repo");
const TEMPLATES = path.join(__dirname, "..", "..", "..", "templates", "engineering", "guardrails");

function report({ moment = "agent", policyDeny = false, results = [] } = {}) {
  return { moment, outcome: { decision: policyDeny ? "deny" : "warn", policyDeny, operationalError: false }, results };
}
function envelope({ decision, eligible = false, findings = [], reason, evidence = "deterministic", unit = "acme/web", control = "web.module-announcement" }) {
  return {
    unit: { id: unit },
    control: { id: control },
    state: "evaluated",
    blockingEligible: eligible,
    result: { decision, reason, findings },
    findingEvidence: findings.map((f) => ({ fingerprint: f.fingerprint, evidenceClass: evidence })),
  };
}
const f = (rule, over = {}) => ({ ruleId: `web.module-announcement/${rule}`, fingerprint: `fp-${rule}`, path: "apps/web/launch.json", severity: "high", remediation: `arregle ${rule}`, ...over });

// --- Eventos -------------------------------------------------------------------

test("T14.8 eventos malformados nunca lanzan: devuelven código y el adaptador permite", () => {
  const bad = ["", "{ roto", "[]", "null", JSON.stringify({}), JSON.stringify({ tool_name: "rm -rf /" }), "x".repeat(1024 * 1024 + 1)];
  for (const raw of bad) {
    const r = A.parseAgentEvent(raw, "kiro", REPO);
    assert.equal(r.ok, false, raw.slice(0, 20));
    assert.match(r.code, /^EVENT_|^SURFACE_/);
  }
  assert.equal(A.kiro.kiroUnavailable("EVENT_UNPARSEABLE").exitCode, 0);
  assert.equal(JSON.parse(A.claude.claudeUnavailable("EVENT_UNPARSEABLE").stdout).hookSpecificOutput.permissionDecision, "allow");
});

test("T14.1/R13.7 evento de escritura: sólo rutas del repo; contenido y comandos nunca salen", () => {
  const raw = JSON.stringify({ tool_name: "fs_write", tool_input: { path: "apps/web/src/modules/x/index.tsx", text: "SECRETO-CONTENIDO const token = 1" }, prompt: "PROMPT-PRIVADO" });
  const r = A.parseAgentEvent(raw, "kiro", REPO);
  assert.deepEqual(r, { ok: true, kind: "write", toolName: "fs_write", paths: ["apps/web/src/modules/x/index.tsx"], outside: 0 });
  assert.ok(!JSON.stringify(r).includes("SECRETO") && !JSON.stringify(r).includes("PROMPT"));
  const claude = A.parseAgentEvent({ tool_name: "Edit", tool_input: { file_path: path.join(REPO, "apps/web/a.ts") } }, "claude", REPO);
  assert.deepEqual(claude.paths, ["apps/web/a.ts"]);
  const outside = A.parseAgentEvent({ tool_name: "Write", tool_input: { file_path: "/etc/passwd" } }, "claude", REPO);
  assert.deepEqual([outside.paths, outside.outside], [[], 1]);
  assert.equal(A.parseAgentEvent({ tool_name: "Bash", tool_input: { command: "echo hi > apps/web/a.ts" } }, "claude", REPO).kind, "opaque");
  assert.equal(A.parseAgentEvent({ tool_name: "mcp__fs__write", tool_input: {} }, "claude", REPO).kind, "opaque");
  assert.equal(A.parseAgentEvent({ tool_name: "execute_bash", tool_input: {} }, "kiro", REPO).kind, "opaque");
});

// --- Decisión de agente --------------------------------------------------------------

test("T14.1 agent: artefactos completables en el mismo cambio nunca bloquean; sólo deny elegible con findings reales", () => {
  const partial = report({ policyDeny: true, results: [envelope({ decision: "deny", eligible: true, findings: [f("required-signal-missing"), f("metadata-invalid")] })] });
  const d1 = A.agentDecision(partial);
  assert.equal(d1.decision, "warn");
  assert.equal(d1.blocking, false);
  assert.match(d1.messages[0], /pendiente de completar/);
  const real = report({ policyDeny: true, results: [envelope({ decision: "deny", eligible: true, findings: [f("keyboard")] })] });
  assert.deepEqual(A.agentDecision(real).blockingResults, [{ unitId: "acme/web", controlId: "web.module-announcement", rules: ["keyboard"] }]);
  const notEligible = report({ results: [envelope({ decision: "warn", findings: [f("keyboard")], reason: "DENY_NOT_ELIGIBLE" })] });
  assert.equal(A.agentDecision(notEligible).decision, "warn");
  assert.equal(A.agentDecision(report({ results: [envelope({ decision: "allow" })] })).decision, "allow");
});

// --- Kiro / Claude ---------------------------------------------------------------------

test("T14.2 Kiro: allow/warn ⇒ exit 0 con feedback; deny elegible ⇒ exit 2; nunca ask", () => {
  assert.deepEqual(A.kiro.kiroResponse({ decision: "allow", messages: [] }), { exitCode: 0, stderr: "", stdout: "" });
  const warn = A.kiro.kiroResponse({ decision: "warn", messages: ["search.input-rate @ acme/web: warn — falta contrato"] });
  assert.equal(warn.exitCode, 0);
  assert.match(warn.stderr, /kiritek engineering: search.input-rate/);
  assert.equal(A.kiro.kiroResponse({ decision: "deny", messages: ["x: deny — keyboard"] }).exitCode, 2);
  assert.deepEqual(Object.values(A.kiro.EXIT).sort(), [0, 2]);
  const many = A.kiro.kiroResponse({ decision: "warn", messages: Array.from({ length: 12 }, (_, i) => `m${i}`) });
  assert.match(many.stderr, /y 4 más/);
});

test("T14.3 Claude: protocolo nativo; warn ⇒ allow o ask por config, nunca deny; deny sólo si el core lo emitió", () => {
  const decisionOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
  const warn = { decision: "warn", messages: ["heurística"] };
  assert.equal(decisionOf(A.claude.claudeResponse(warn)), "allow");
  assert.equal(decisionOf(A.claude.claudeResponse(warn, { warnAs: "ask" })), "ask");
  assert.equal(decisionOf(A.claude.claudeResponse(warn, { warnAs: "deny" })), "allow", "no se puede elevar warn a deny");
  assert.equal(decisionOf(A.claude.claudeResponse({ decision: "deny", messages: ["x"] })), "deny");
  for (const d of ["allow", "warn", "deny"]) assert.equal(A.claude.claudeResponse({ decision: d, messages: [] }).exitCode, 0);
  const out = JSON.parse(A.claude.claudeResponse(warn).stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
});

test("T14.8 paridad: misma decisión central ⇒ mismo bloqueo en Kiro y Claude", () => {
  for (const r of [
    report({ results: [envelope({ decision: "allow" })] }),
    report({ results: [envelope({ decision: "warn", reason: "w" })] }),
    report({ policyDeny: true, results: [envelope({ decision: "deny", eligible: true, findings: [f("close")] })] }),
    report({ policyDeny: true, results: [envelope({ decision: "deny", eligible: true, findings: [f("required-signal-missing")] })] }),
  ]) {
    const d = A.agentDecision(r);
    const kiroBlocks = A.kiro.kiroResponse(d).exitCode === 2;
    const claudeBlocks = JSON.parse(A.claude.claudeResponse(d).stdout).hookSpecificOutput.permissionDecision === "deny";
    assert.equal(kiroBlocks, claudeBlocks);
    assert.equal(kiroBlocks, d.blocking);
  }
});

// --- CI --------------------------------------------------------------------------------

test("T14.5/T14.8 CI: plan sin secretos; rango completo; shallow avisado; release exige artefacto y unidad", () => {
  const head = "a".repeat(40);
  const base = "b".repeat(40);
  const pr = A.ci.planCiInvocation({ event: "pull_request", base, head });
  assert.deepEqual(pr.args, ["guardrails", "scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline", "--format=json"]);
  assert.ok(!pr.args.some((a) => /token|secret|key/i.test(a)));
  assert.match(A.ci.planCiInvocation({ event: "pull_request", base, head, shallow: true }).notes[0], /SCOPE_RANGE_INCOMPLETE/);
  assert.equal(A.ci.planCiInvocation({ event: "pull_request", head }).code, "CI_BASE_REQUIRED");
  assert.equal(A.ci.planCiInvocation({ event: "release", head }).code, "CI_ARTIFACT_REQUIRED");
  assert.equal(A.ci.planCiInvocation({ event: "release", head, artifactRef: "dist/app-4.2.0.tgz" }).code, "CI_UNIT_REQUIRED");
  const rel = A.ci.planCiInvocation({ event: "release", head, artifactRef: "dist/app-4.2.0.tgz", units: ["acme/web"] });
  assert.deepEqual(rel.args.slice(0, 3), ["guardrails", "scan", "--moment=release"]);
  assert.ok(rel.args.includes("--artifact=dist/app-4.2.0.tgz") && rel.args.includes("--unit=acme/web"));
  assert.equal(A.ci.planCiInvocation({ event: "deploy", head }).code, "CI_EVENT_UNKNOWN");
});

test("T14.5 anotaciones neutrales: heurística nunca failure; error operativo es notice; suprimidos no se anotan", () => {
  const r = report({
    moment: "pr",
    results: [
      envelope({ decision: "deny", eligible: true, findings: [f("close"), f("keyboard", { status: "suppressed" })] }),
      envelope({ decision: "deny", eligible: true, findings: [f("contrast")], evidence: "heuristic", control: "search.input-rate" }),
      envelope({ decision: "warn", reason: "falta contrato", control: "app.minimum-supported-version" }),
      envelope({ decision: "error", reason: "HARNESS_TIMEOUT", control: "x.y" }),
      envelope({ decision: "allow" }),
    ],
  });
  const ann = A.ci.toAnnotations(r);
  assert.deepEqual(ann.map((a) => [a.controlId, a.level, a.ruleId || null]), [
    ["web.module-announcement", "failure", "web.module-announcement/close"],
    ["search.input-rate", "warning", "web.module-announcement/contrast"],
    ["app.minimum-supported-version", "warning", null],
    ["x.y", "notice", null],
  ]);
  assert.equal(ann[0].path, "apps/web/launch.json");
  assert.match(A.ci.toSummary(r), /\| acme\/web \| web.module-announcement \| evaluated \| deny \|/);
});

test("T14.5 el workflow del proveedor sólo invoca el CLI: sin reglas, sin secretos, rango completo", () => {
  const yml = fs.readFileSync(path.join(TEMPLATES, "ci", "github", "kiritek-engineering.yml"), "utf8");
  assert.match(yml, /kiritek-init guardrails scan --moment=pr/);
  assert.match(yml, /fetch-depth: 0/);
  assert.ok(!/secrets\./.test(yml), "no requiere secretos (forks)");
  assert.ok(!/\$\{\{[^}]*\}\}[^\n]*kiritek-init/.test(yml), "contexto vía env, no interpolado en el comando");
  for (const forbidden of ["debounce", "semver", "contrast", "minimumVersion", "ruleId"]) assert.ok(!yml.includes(forbidden), `sin lógica de control: ${forbidden}`);
  // Supply chain (T15B.4/T16): Actions por SHA y CLI en versión exacta, sin -g.
  for (const m of yml.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `acción no fijada por SHA: ${m[1]}`);
  assert.ok(yml.includes(`kiritek-init@${require("../../../package.json").version}`));
  assert.ok(!/npm install[^\n]*-g\b/.test(yml), "sin instalación global");
});

// --- Cobertura ---------------------------------------------------------------------------

test("T14.7 cobertura: lo no interceptable se declara unavailable con cobertura posterior; momentos ausentes quedan pending", () => {
  const { catalog } = resolveCatalog({ version: "1.0.0" });
  const m = A.coverageMatrix(catalog);
  const row = (c, s) => m.rows.find((r) => r.controlId === c && r.surface === s);
  assert.deepEqual(row("app.minimum-supported-version", "kiro"), { controlId: "app.minimum-supported-version", surface: "kiro", moment: "agent", status: "pending", coveredBy: ["pr", "release"] });
  assert.equal(row("search.input-rate", "claude").status, "covered");
  assert.equal(row("web.module-announcement", "git-pre-commit").status, "covered");
  assert.ok(m.notInterceptable.some((n) => n.surface === "claude" && /Bash/.test(n.operation) && n.status === "unavailable" && n.coveredBy.includes("pr")));
  assert.ok(m.notInterceptable.some((n) => n.surface === "git-pre-commit" && /--no-verify/.test(n.operation)));
});
