"use strict";

// T15: auditoría por capacidades, estados, self-checks, doctor/promote y
// separación de security, sobre un repo Git real con los tres controles.

const test = require("node:test");
const assert = require("node:assert/strict");
const { POSIX_ONLY, NEEDS_SANDBOX } = require("../helpers/platform.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = os.devNull;

const { CONFIG, git, write, makeRepo, runCli, config } = require("../helpers/surfaces-repo.js");
const H = require("../helpers/catalogs.js");
const { multiDomainReport, STATUSES } = require("../../../src/engineering/guardrails/audit/index.js");
const { runCapabilityAudit } = require("../../../src/audit/capabilities.js");
const { KIRO_SHIM, KIRO_HOOK, CLAUDE_SHIM } = require("../../../src/engineering/guardrails/adapters/install.js");

const VERSION = "app.minimum-supported-version";
const clean = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const caps = (r) => r.json.audit.capabilities;
const cap = (r, unitId, controlId, moment) => caps(r).find((c) => c.unitId === unitId && c.controlId === controlId && c.moment === moment);

async function scanPr(repo, base, head, extra) {
  const r = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo, extra);
  assert.equal(r.code, 0, r.err);
  return r;
}

// --- T15.1 / T15.2 ----------------------------------------------------------------------

test("T15.1/T15.2 sin ejecuciones: unknown; distingue off, sugerido y no aplicable; sin filas para momentos no soportados", async () => {
  const { repo } = makeRepo();
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    doc.workspace.units[0].controls["search.input-rate"].level = "off";
    write(repo, CONFIG, JSON.stringify(doc, null, 2));
    write(repo, "apps/mobile/package.json", JSON.stringify({ dependencies: { "fuse.js": "7.0.0" } }));
    const r = await runCli(["audit"], repo);
    assert.equal(r.code, 0, r.err);
    assert.equal(cap(r, "acme/web", "search.input-rate", "pr").status, "off");
    assert.equal(cap(r, "acme/web", "web.module-announcement", "pr").status, "unknown");
    assert.equal(cap(r, "acme/web", "web.module-announcement", "pr").lastRun, null);
    assert.equal(cap(r, "acme/mobile", "search.input-rate", "pr").status, "suggested", "perfil sólo sugerido por discovery");
    assert.equal(cap(r, "acme/mobile", "web.module-announcement", "pr").status, "not_applicable");
    assert.equal(cap(r, "acme/mobile", VERSION, "agent"), undefined);
    const a = r.json.audit;
    assert.deepEqual(Object.keys(a.summary.byStatus).sort(), [...STATUSES].sort());
    assert.ok(a.summary.byUnit["acme/web"] && a.summary.byMoment.pr && a.summary.byLevel.warn);
    assert.deepEqual(a.profiles.find((p) => p.unitId === "acme/mobile").suggested.map((s) => s.id), ["search"]);
    for (const k of ["ok", "compliant", "passed", "conformant"]) assert.equal(k in a, false, "sin booleano global");
  } finally {
    clean(repo);
  }
});

test("T15.1 tras un scan de PR: verified con lastRun, resultado, frescura y evidenceRef real", async () => {
  const { repo, base, head } = makeRepo();
  try {
    await scanPr(repo, base, head);
    const r = await runCli(["audit"], repo);
    for (const [unitId, controlId] of [["acme/web", "search.input-rate"], ["acme/web", "web.module-announcement"], ["acme/mobile", VERSION]]) {
      const c = cap(r, unitId, controlId, "pr");
      assert.equal(c.status, "verified", `${controlId}: ${c.reason}`);
      assert.equal(c.lastResult, "allow");
      assert.equal(c.lastResultFresh, true);
      assert.ok(fs.existsSync(path.join(repo, c.evidenceRef)), c.evidenceRef);
      assert.equal(c.momentCovered, "unknown", "CI remoto nunca verified por config local");
    }
    assert.equal(cap(r, "acme/web", "search.input-rate", "release").status, "unknown");
  } finally {
    clean(repo);
  }
});

// --- T15.6 ----------------------------------------------------------------------------------

test("T15.6 evidencia de otra revisión ⇒ stale; config cambiada ⇒ drift; evidencia borrada ⇒ unknown; conflicto ⇒ conflict", async () => {
  const { repo, base, head } = makeRepo();
  try {
    await scanPr(repo, base, head);
    write(repo, "apps/web/src/app.ts", "export const app = 3;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "otra");
    const stale = await runCli(["audit"], repo);
    assert.equal(cap(stale, "acme/web", "search.input-rate", "pr").status, "stale");
    assert.match(cap(stale, "acme/web", "search.input-rate", "pr").reason, /otra revisión/);

    git(repo, "reset", "-q", "--hard", head);
    const verified = await runCli(["audit"], repo);
    const ref = cap(verified, "acme/web", "search.input-rate", "pr").evidenceRef;
    fs.rmSync(path.join(repo, ref));
    assert.equal(cap(await runCli(["audit"], repo), "acme/web", "search.input-rate", "pr").status, "unknown");

    const ledgerPath = path.join(repo, ".kiritek/evidence/engineering/runs/pr.json");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    ledger.results.find((x) => x.unitId === "acme/web" && x.controlId === "web.module-announcement").state = "conflict";
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    assert.equal(cap(await runCli(["audit"], repo), "acme/web", "web.module-announcement", "pr").status, "conflict");

    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    doc.workspace.units[1].controls[VERSION].parameters.timeoutMs = 4000;
    write(repo, CONFIG, JSON.stringify(doc, null, 2));
    assert.equal(cap(await runCli(["audit"], repo), "acme/mobile", VERSION, "pr").status, "drift");
  } finally {
    clean(repo);
  }
});

test("T15.6 superficies presentes pero desconectadas, alteradas o no ejecutables no cuentan como cobertura", { skip: POSIX_ONLY }, async () => {
  const { repo } = makeRepo();
  try {
    await runCli(["install", "--surfaces=kiro,claude,git,ci"], repo);
    const ok = (await runCli(["audit"], repo)).json.audit;
    assert.deepEqual(Object.fromEntries(Object.entries(ok.surfaces).map(([k, v]) => [k, v.status])), { kiro: "verified", claude: "verified", "git-pre-commit": "verified", ci: "unknown", release: "unknown" });
    assert.equal(ok.capabilities.find((c) => c.moment === "pre-commit").momentCovered, "verified");

    fs.appendFileSync(path.join(repo, KIRO_SHIM), "\n# alterado\n");
    fs.chmodSync(path.join(repo, CLAUDE_SHIM), 0o644);
    fs.rmSync(path.join(repo, ".git/hooks/pre-commit"));
    fs.appendFileSync(path.join(repo, ".github/workflows/kiritek-engineering.yml"), "\n# alterado\n");
    const bad = (await runCli(["audit"], repo)).json.audit;
    assert.equal(bad.surfaces.kiro.status, "drift");
    assert.equal(bad.surfaces.claude.status, "not-executable");
    assert.equal(bad.surfaces["git-pre-commit"].status, "disconnected");
    assert.equal(bad.surfaces.ci.status, "drift");
    assert.equal(bad.capabilities.find((c) => c.moment === "pre-commit").momentCovered, "unavailable");
    assert.equal(bad.capabilities.find((c) => c.moment === "agent").momentCovered, "drift");

    fs.rmSync(path.join(repo, KIRO_HOOK));
    assert.equal((await runCli(["audit"], repo)).json.audit.surfaces.kiro.status, "disconnected");
  } finally {
    clean(repo);
  }
});

test("T15.6 artefactos del pack alterados ⇒ integridad failed y drift (la config editada no cuenta)", async () => {
  const { repo, base, head } = makeRepo();
  try {
    const cfg = fs.readFileSync(path.join(repo, CONFIG), "utf8");
    await runCli(["install"], repo);
    write(repo, CONFIG, cfg);
    await scanPr(repo, base, head);
    assert.equal((await runCli(["audit"], repo)).json.audit.pack.integrity, "ok");
    fs.appendFileSync(path.join(repo, ".kiritek/.gitignore"), "otra-cosa/\n");
    const r = await runCli(["audit"], repo);
    assert.equal(r.json.audit.pack.integrity, "failed");
    assert.deepEqual(r.json.audit.pack.altered, [{ path: ".kiritek/.gitignore", reason: "modified" }]);
    assert.equal(cap(r, "acme/web", "search.input-rate", "pr").status, "drift");
  } finally {
    clean(repo);
  }
});

// --- T15.3 / R19.7 ----------------------------------------------------------------------------

test("T15.3 audit --deep: self-checks sintéticos (heurística no bloquea, determinista elegible, canario) y salida de texto", async () => {
  const { repo } = makeRepo();
  try {
    const r = await runCli(["audit", "--deep"], repo);
    const sc = r.json.audit.selfCheck;
    assert.equal(sc.passed, true, JSON.stringify(sc.checks));
    const builtins = Object.keys(require("../../../src/engineering/guardrails/controls/index.js").builtinControls()).length;
    assert.equal(sc.checks.filter((c) => c.id === "deterministic-eligible").length, builtins);
    assert.equal(sc.checks.filter((c) => c.id === "heuristic-never-blocks").length, builtins);
    assert.ok(sc.checks.some((c) => c.id === "redaction-canary" && c.passed));
    const text = await runCli(["audit", "--format=text"], repo);
    assert.equal(text.code, 0);
    assert.match(text.out, /acme\/web · search.input-rate · pr · warn → unknown/);
    assert.match(text.out, /no interceptable/);
    assert.equal((await runCli(["scan", "--moment=pr", "--format=text"], repo)).code, 2, "text sólo en audit");
  } finally {
    clean(repo);
  }
});

// --- T15.5 --------------------------------------------------------------------------------------

test("T15.5 engineering ausente o security ausente: ninguno marca fallo al otro; reporte multidominio sin booleano", async () => {
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-aud-empty-")));
  const { repo } = makeRepo();
  try {
    const absent = await runCli(["audit"], empty);
    assert.equal(absent.code, 0);
    assert.equal(absent.json.audit.pack.status, "absent");
    write(repo, "kiritek-security.config.json", "{ roto");
    const eng = await runCli(["audit"], repo);
    assert.equal(eng.code, 0, "una config security corrupta no afecta a engineering");
    const security = runCapabilityAudit(repo);
    const multi = multiDomainReport({ engineering: eng.json.audit, security });
    assert.deepEqual(Object.keys(multi.domains).sort(), ["engineering", "security"]);
    assert.equal(multi.domains.engineering.status, "present");
    for (const k of ["ok", "passed", "compliant", "allGreen"]) assert.equal(k in multi, false);
    assert.equal(multiDomainReport({ engineering: absent.json.audit, security: null }).domains.engineering.status, "absent");
    assert.equal(multiDomainReport({ engineering: absent.json.audit, security: null }).domains.security.status, "absent");
    assert.ok(!JSON.stringify(eng.json.audit).includes("kiritek-security"), "la auditoría engineering no lee security");
  } finally {
    clean(empty);
    clean(repo);
  }
});

// --- T15.4 doctor / promote --------------------------------------------------------------------

let enforceRoot = null;
function enforceCatalog() {
  if (!enforceRoot) {
    enforceRoot = H.tmpDir("kiritek-eng-aud-cat-");
    H.writeCatalog(enforceRoot, H.buildFiles((d) => {
      d.version = "1.2.0";
      const ctl = d.controls.find((c) => c.id === VERSION);
      ctl.supportedLevels = ["off", "warn", "enforce"];
      ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: "kiritek/engineering/app-minimum-supported-version", approvedVersion: "1.0.0", moments: ["pr", "release"] };
    }));
    process.on("exit", () => fs.rmSync(enforceRoot, { recursive: true, force: true }));
  }
  return { roots: [enforceRoot], approvedConformanceSuites: ["kiritek/engineering/app-minimum-supported-version@1.0.0"] };
}

test("T15.4 doctor/promote con catálogo warn-only: no listo; enforce rechazado; volver a warn siempre permitido", async () => {
  const { repo } = makeRepo();
  try {
    const d = await runCli(["doctor", "--unit=acme/mobile", `--control=${VERSION}`], repo);
    assert.equal(d.json.readiness, "not-ready");
    const ids = d.json.targets[0].checks.filter((c) => !c.passed && c.severity === "blocker").map((c) => c.id);
    assert.ok(ids.includes("enforce-supported") && ids.includes("enforcement-contract"), ids.join(","));
    const p = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=enforce"], repo);
    assert.equal(p.code, 3);
    assert.equal(p.json.promoted, false);
    const before = fs.readFileSync(path.join(repo, CONFIG), "utf8");
    const rb = await runCli(["promote", "--unit=acme/web", "--control=search.input-rate", "--to=warn"], repo);
    assert.equal(rb.code, 0, rb.err);
    assert.equal(rb.json.promoted, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8")).workspace.units[0].controls["search.input-rate"].parameters.behaviorContract, "apps/web/search.contract.json", "rollback conserva parámetros");
    assert.notEqual(before, undefined);
  } finally {
    clean(repo);
  }
});

test("T15.4 readiness completo ⇒ promote sólo de ese par; waivers inválidos o falsos positivos lo bloquean", async () => {
  const { repo, base, head } = makeRepo();
  const extra = { catalogOptions: enforceCatalog() };
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    doc.pack.catalog = "1.2.0";
    write(repo, CONFIG, JSON.stringify(doc, null, 2));
    write(repo, ".github/CODEOWNERS", "apps/mobile/ @acme/mobile\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "catálogo 1.2.0");
    const headNow = git(repo, "rev-parse", "HEAD");

    const before = await runCli(["doctor", "--unit=acme/mobile", `--control=${VERSION}`], repo, extra);
    const missing = before.json.targets[0].checks.filter((c) => !c.passed).map((c) => c.id);
    assert.ok(missing.includes("evidence:pr") && missing.includes("evidence:release") && missing.includes("surface:pr"), missing.join(","));

    await runCli(["install", "--surfaces=ci"], repo, extra);
    await scanPr(repo, base, headNow, extra);
    const rel = await runCli(["scan", "--moment=release", "--unit=acme/mobile", `--revision=${headNow}`, "--artifact=dist/app.aab", "--offline"], repo, extra);
    assert.equal(rel.code, 0, rel.err);
    const ready = await runCli(["doctor", "--unit=acme/mobile", `--control=${VERSION}`], repo, extra);
    assert.equal(ready.json.readiness, "ready", JSON.stringify(ready.json.blockers));
    assert.ok(ready.json.targets[0].checks.find((c) => c.id === "ownership").passed);

    const dry = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=enforce", "--dry-run"], repo, extra);
    assert.deepEqual([dry.code, dry.json.promoted, dry.json.dryRun], [0, false, true]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8")).workspace.units[1].controls[VERSION].level, "warn");

    // Falsos positivos por encima del umbral bloquean la promoción (R20.3).
    for (let i = 0; i < 6; i += 1) {
      await runCli(["feedback", `--control=${VERSION}`, `--rule=${VERSION}/grace`, `--fingerprint=fp-${i}`, `--verdict=${i < 2 ? "confirmed" : "false-positive"}`], repo, extra);
    }
    const noisy = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=enforce"], repo, extra);
    assert.equal(noisy.json.promoted, false);
    assert.ok(noisy.json.blockers.some((b) => b.startsWith("quality:")), noisy.json.blockers.join("; "));
    fs.rmSync(path.join(repo, ".kiritek/telemetry"), { recursive: true, force: true });

    write(repo, ".kiritek/engineering/waivers/self.json", JSON.stringify({ schemaVersion: 1, kind: "waiver", id: "W-self", controlId: VERSION, controlVersion: "1.0.0", unitId: "acme/mobile", target: { ruleId: `${VERSION}/grace` }, scope: { paths: ["apps/mobile/**"] }, owner: "team-mobile", reason: "Autoaprobado, debe rechazarse.", ticket: "MOB-1", approver: "team-mobile", createdAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" }));
    const waived = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=enforce"], repo, extra);
    assert.ok(waived.json.blockers.some((b) => b.startsWith("exceptions:")), waived.json.blockers.join("; "));
    fs.rmSync(path.join(repo, ".kiritek/engineering/waivers"), { recursive: true, force: true });

    const p = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=enforce"], repo, extra);
    assert.equal(p.code, 0, JSON.stringify(p.json));
    assert.equal(p.json.promoted, true);
    const after = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    assert.equal(after.workspace.units[1].controls[VERSION].level, "enforce");
    assert.deepEqual(after.workspace.units[0].controls, config.workspace.units[0].controls, "otros controles intactos");
    const back = await runCli(["promote", "--unit=acme/mobile", `--control=${VERSION}`, "--to=warn"], repo, extra);
    assert.equal(back.json.from, "enforce");
    assert.ok(fs.existsSync(path.join(repo, ".kiritek/evidence/engineering/runs/pr.json")), "rollback conserva evidencia");
  } finally {
    clean(repo);
  }
});
