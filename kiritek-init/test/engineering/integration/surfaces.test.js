"use strict";

// T14: superficies reales (agent Kiro/Claude, Git pre-commit, PR, release)
// sobre un repo Git con los tres controles builtin en `warn`.

const test = require("node:test");
const assert = require("node:assert/strict");
const { POSIX_ONLY, NEEDS_SANDBOX } = require("../helpers/platform.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Aislar de la config Git global/sistema del desarrollador (hooksPath, firma).
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = os.devNull;

const cli = require("../../../src/engineering/guardrails/cli.js");
const gitAdapter = require("../../../src/engineering/guardrails/adapters/git.js");
const { CLAUDE_SETTINGS, KIRO_SHIM, KIRO_HOOK } = require("../../../src/engineering/guardrails/adapters/install.js");

const { CONFIG, NOW, BUDGET, git, write, makeRepo, runCli } = require("../helpers/surfaces-repo.js");

/** Ningún resultado en timeout y cada duración dentro del presupuesto del momento. */
function assertWithinBudget(json, moment) {
  for (const e of json.results) {
    assert.notEqual(e.state, "timeout", `${e.unit.id}/${e.control.id}`);
    assert.ok(e.durationMs <= BUDGET[moment], `${e.control.id} ${e.durationMs}ms > ${BUDGET[moment]}`);
  }
}

const writeEvent = (tool, p, extra = {}) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { [tool === "fs_write" ? "path" : "file_path"]: p, text: "CONTENIDO-PRIVADO", ...extra } });

// --- T14.1–T14.3 agente -------------------------------------------------------------

test("T14.1/T14.2 Kiro: feedback rápido de agent, exit 0 en warn, nunca deny por escritura parcial", async () => {
  const { repo } = makeRepo();
  try {
    const r = await runCli(["hook", "kiro"], repo, { stdinText: writeEvent("fs_write", "apps/web/src/modules/billing/index.tsx") });
    assert.equal(r.code, 0);
    assert.match(r.err, /kiritek engineering: .*BEHAVIOR_DEFERRED/);
    assert.ok(!r.err.includes("CONTENIDO-PRIVADO") && !r.out.includes("CONTENIDO-PRIVADO"));
    assert.ok(r.elapsedMs < 10000, `agent tardó ${r.elapsedMs}ms`);
    for (const raw of ["{ roto", JSON.stringify({ tool_name: "fs_write" })]) {
      const bad = await runCli(["hook", "kiro"], repo, { stdinText: raw });
      assert.equal(bad.code, 0, "payload malformado no bloquea");
    }
    const opaque = await runCli(["hook", "kiro"], repo, { stdinText: JSON.stringify({ tool_name: "execute_bash", tool_input: { command: "echo x > apps/web/a.ts" } }) });
    assert.deepEqual([opaque.code, opaque.err], [0, ""], "no interceptable: no se simula evaluación");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T14.3 Claude: JSON nativo; warn ⇒ allow (o ask por config), nunca deny", async () => {
  const { repo } = makeRepo();
  try {
    const event = writeEvent("Write", path.join(repo, "apps/web/launch.json"));
    const decision = (r) => JSON.parse(r.out).hookSpecificOutput.permissionDecision;
    const r = await runCli(["hook", "claude"], repo, { stdinText: event });
    assert.equal(r.code, 0);
    assert.equal(decision(r), "allow");
    assert.match(JSON.parse(r.out).hookSpecificOutput.permissionDecisionReason, /BEHAVIOR_DEFERRED/);
    assert.equal(decision(await runCli(["hook", "claude", "--warn-as=ask"], repo, { stdinText: event })), "ask");
    assert.equal((await runCli(["hook", "claude", "--warn-as=deny"], repo, { stdinText: event })).code, cli.EXIT.USAGE);
    assert.equal(decision(await runCli(["hook", "claude"], repo, { stdinText: "nope" })), "allow");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- T14.4 pre-commit -----------------------------------------------------------------

test("T14.4 pre-commit: sólo staged, offline, checks rápidos (harness diferido)", async () => {
  const { repo } = makeRepo();
  try {
    write(repo, "apps/web/src/staged.ts", "export const s = 1;\n");
    git(repo, "add", "apps/web/src/staged.ts");
    write(repo, "apps/mobile/lib/unstaged.dart", "// no staged\n");
    const r = await runCli(["scan", "--moment=pre-commit", "--offline"], repo);
    assert.equal(r.code, 0, r.err);
    const evaluated = r.json.results.filter((e) => e.state === "evaluated");
    assert.deepEqual([...new Set(evaluated.map((e) => e.unit.id))], ["acme/web"], "lo unstaged no entra al alcance");
    for (const e of evaluated) assert.match(e.result.reason, /BEHAVIOR_DEFERRED/);
    assertWithinBudget(r.json, "pre-commit");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T14.4 hook Git: compone con el hook del usuario, idempotente; sólo exit 1 del core bloquea el commit", { skip: POSIX_ONLY }, async () => {
  const { repo } = makeRepo();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-bin-"));
  try {
    write(repo, ".git/hooks/pre-commit", '#!/bin/sh\necho ran >> "$(git rev-parse --show-toplevel)/.user-hook-ran"\n');
    fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
    const first = await runCli(["install", "--surfaces=git"], repo);
    assert.equal(first.code, 0, first.err);
    assert.deepEqual(first.json.surfaces.map((s) => s.status), ["linked"]);
    assert.ok(fs.existsSync(path.join(repo, gitAdapter.PREVIOUS)), "hook del usuario preservado");
    const second = await runCli(["install", "--surfaces=git"], repo);
    assert.deepEqual(second.json.surfaces.map((s) => s.status), ["noop"]);
    assert.equal(gitAdapter.verifyGitIntegration(repo).verified, true);

    // `kiritek-init` falso: devuelve el exit pedido para probar el mapeo.
    write(bin, "kiritek-init", '#!/bin/sh\nexit "${FAKE_KIRITEK_EXIT:-0}"\n');
    fs.chmodSync(path.join(bin, "kiritek-init"), 0o755);
    const commit = (exit, name) => {
      write(repo, `apps/web/src/${name}.ts`, `export const ${name} = 1;\n`);
      git(repo, "add", "-A");
      return spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", name], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_KIRITEK_EXIT: String(exit) },
      });
    };
    assert.equal(commit(1, "denied").status, 1, "deny elegible bloquea");
    assert.equal(commit(3, "operational").status, 0, "error operativo no bloquea");
    assert.equal(commit(0, "ok").status, 0);
    assert.equal(fs.readFileSync(path.join(repo, ".user-hook-ran"), "utf8").trim().split("\n").length, 3, "el hook del usuario corre siempre");

    await runCli(["uninstall"], repo);
    assert.match(fs.readFileSync(path.join(repo, ".git/hooks/pre-commit"), "utf8"), /user-hook-ran/, "uninstall restaura el hook previo");
    assert.equal(fs.existsSync(path.join(repo, gitAdapter.HOOK_SCRIPT)), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test("T14.4/T14.8 coexistencia: hook de security o gestor de terceros ⇒ integración manual verificable, sin tocar nada", { skip: POSIX_ONLY }, async () => {
  const { repo } = makeRepo();
  try {
    const security = "#!/bin/sh\n# Kiritek managed pre-commit hook (dispatcher).\nexit 0\n";
    write(repo, ".git/hooks/pre-commit", security);
    write(repo, "kiritek-security.config.json", '{"security":true}\n');
    const r = await runCli(["install", "--surfaces=git"], repo);
    assert.equal(r.json.surfaces[0].status, "manual");
    assert.equal(r.json.surfaces[0].snippet, gitAdapter.INVOCATION);
    assert.equal(fs.readFileSync(path.join(repo, ".git/hooks/pre-commit"), "utf8"), security, "el hook de security no se modifica");
    assert.equal(gitAdapter.verifyGitIntegration(repo).verified, false, "no se atribuye protección inexistente");
    fs.appendFileSync(path.join(repo, ".git/hooks/pre-commit"), `${gitAdapter.INVOCATION}\n`);
    assert.equal(gitAdapter.verifyGitIntegration(repo).verified, true);
    write(repo, "lefthook.yml", "pre-commit:\n");
    assert.equal(gitAdapter.planGitIntegration(repo).strategy, "manual");
    assert.equal(fs.readFileSync(path.join(repo, "kiritek-security.config.json"), "utf8"), '{"security":true}\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T14.2/T14.3/T14.8 enlace Kiro/Claude: coexiste con security y el usuario; shims fail-open", { skip: POSIX_ONLY }, async () => {
  const { repo } = makeRepo();
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-bin-"));
  try {
    const userEntry = { matcher: "Bash", hooks: [{ type: "command", command: "./mi-hook.sh" }] };
    const securityEntry = { matcher: "Edit|Write", hooks: [{ type: "command", command: '"$CLAUDE_PROJECT_DIR/.kiritek/adapters/claude/pretooluse.sh"' }] };
    write(repo, CLAUDE_SETTINGS, JSON.stringify({ hooks: { PreToolUse: [userEntry, securityEntry] } }));
    write(repo, ".kiro/hooks/kiritek-security-write.json", '{"version":"v1"}\n');
    const r = await runCli(["install", "--surfaces=kiro,claude"], repo);
    assert.deepEqual(r.json.surfaces.map((s) => [s.surface, s.status]), [["kiro", "linked"], ["claude", "linked"]]);
    const again = await runCli(["install", "--surfaces=kiro,claude"], repo);
    assert.deepEqual(again.json.surfaces.map((s) => s.status), ["noop", "noop"]);
    const settings = JSON.parse(fs.readFileSync(path.join(repo, CLAUDE_SETTINGS), "utf8"));
    assert.equal(settings.hooks.PreToolUse.length, 3);
    assert.deepEqual(settings.hooks.PreToolUse.slice(0, 2), [userEntry, securityEntry]);

    // Shim Kiro: sólo exit 2 del core bloquea; CLI ausente o fallido ⇒ permite.
    write(bin, "kiritek-init", '#!/bin/sh\ncat >/dev/null\nexit "${FAKE_KIRITEK_EXIT:-0}"\n');
    fs.chmodSync(path.join(bin, "kiritek-init"), 0o755);
    const shim = (exit, withCli = true) =>
      spawnSync("sh", [path.join(repo, KIRO_SHIM)], { input: "{}", encoding: "utf8", env: { PATH: withCli ? `${bin}${path.delimiter}/usr/bin:/bin` : "/usr/bin:/bin", FAKE_KIRITEK_EXIT: String(exit) } }).status;
    assert.deepEqual([shim(2), shim(3), shim(5), shim(0), shim(0, false)], [2, 0, 0, 0, 0]);

    await runCli(["uninstall"], repo);
    const after = JSON.parse(fs.readFileSync(path.join(repo, CLAUDE_SETTINGS), "utf8"));
    assert.deepEqual(after.hooks.PreToolUse, [userEntry, securityEntry], "sólo se quita lo engineering");
    assert.equal(fs.existsSync(path.join(repo, KIRO_HOOK)), false);
    assert.equal(fs.readFileSync(path.join(repo, ".kiro/hooks/kiritek-security-write.json"), "utf8"), '{"version":"v1"}\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

// --- T14.5 PR / T14.6 release -----------------------------------------------------------

test("T14.5/T14.8 PR: rango completo con tests contractuales, anotaciones neutrales y paridad por revisión/config/catálogo", async () => {
  const { repo, base, head } = makeRepo();
  try {
    const a = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo);
    assert.equal(a.code, 0, a.err);
    const ev = a.json.results.filter((e) => e.state === "evaluated");
    assert.deepEqual(ev.map((e) => `${e.unit.id}:${e.control.id}:${e.result.decision}`).sort(), [
      "acme/mobile:app.minimum-supported-version:allow",
      "acme/web:search.input-rate:allow",
      "acme/web:web.module-announcement:allow",
    ]);
    for (const e of ev) assert.equal(e.evidenceCompleteness, "complete", "harness ejecutado en PR");
    assertWithinBudget(a.json, "pr");
    assert.ok(Array.isArray(a.json.annotations));
    const b = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo);
    const strip = (j) => j.results.map((e) => ({ unit: e.unit.id, control: e.control.id, state: e.state, decision: e.result && e.result.decision, scopeHash: e.scopeHash, configHash: e.configHash, catalog: e.catalog.digest, fps: e.result ? e.result.findings.map((f) => f.fingerprint) : [] }));
    assert.deepEqual(strip(a.json), strip(b.json));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T14.8 shallow history: rango incompleto es error operativo, nunca deny", async () => {
  const { repo, base, head } = makeRepo();
  const shallow = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-shallow-")));
  try {
    fs.rmSync(shallow, { recursive: true, force: true });
    git(os.tmpdir(), "clone", "-q", "--depth", "1", `file://${repo}`, shallow);
    const r = await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], shallow);
    assert.notEqual(r.code, cli.EXIT.POLICY_DENY);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, "SCOPE_RANGE_INCOMPLETE");
    assert.match(r.json.remediation, /fetch-depth: 0/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(shallow, { recursive: true, force: true });
  }
});

test("T14.6 release: artefacto candidato y unidad explícita; evidencia fresca de harness", async () => {
  const { repo, head } = makeRepo();
  try {
    const r = await runCli(["scan", "--moment=release", "--unit=acme/mobile", `--revision=${head}`, "--artifact=dist/app-4.2.0.aab", "--offline"], repo);
    assert.equal(r.code, 0, r.err);
    const e = r.json.results.find((x) => x.unit.id === "acme/mobile" && x.control.id === "app.minimum-supported-version");
    assert.equal(e.state, "evaluated");
    assert.equal(e.evidenceFreshness, "fresh");
    assert.equal(e.evidenceCompleteness, "complete");
    assertWithinBudget(r.json, "release");
    const missing = await runCli(["scan", "--moment=release", `--revision=${head}`, "--offline"], repo);
    assert.equal(missing.json.error, "SCOPE_RELEASE_SELECTION_REQUIRED");
    assert.notEqual(missing.code, cli.EXIT.POLICY_DENY);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- T14.7 / T14.9 ----------------------------------------------------------------------------

test("T14.7 audit declara cobertura por superficie y verificación real del hook Git", async () => {
  const { repo } = makeRepo();
  try {
    const r = await runCli(["audit"], repo);
    assert.equal(r.code, 0, r.err);
    const a = r.json.audit;
    assert.ok(a.capabilities.every((c) => c.linkage === "verified" && c.executable));
    assert.equal(a.surfaces["git-pre-commit"].status, "missing", "sin hook instalado no hay protección atribuida");
    assert.ok(a.capabilities.filter((c) => c.moment === "pre-commit").every((c) => c.momentCovered === "unavailable"));
    assert.ok(!a.capabilities.some((c) => c.controlId === "app.minimum-supported-version" && c.moment === "agent"), "momento no soportado: sin fila");
    assert.ok(a.notInterceptable.length > 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T14.9 gate warning-only: los tres controles corren en todas las superficies sin bloquear y dentro de presupuesto", async () => {
  const { repo, base, head } = makeRepo();
  try {
    const kiro = await runCli(["hook", "kiro"], repo, { stdinText: writeEvent("fs_write", "apps/web/launch.json") });
    const claude = await runCli(["hook", "claude"], repo, { stdinText: writeEvent("Edit", path.join(repo, "apps/web/search.contract.json")) });
    assert.equal(kiro.code, 0);
    assert.notEqual(JSON.parse(claude.out).hookSpecificOutput.permissionDecision, "deny");
    write(repo, "apps/mobile/lib/gate.dart", "// gate v2\n");
    write(repo, "apps/web/src/app.ts", "export const app = 2;\n");
    git(repo, "add", "-A");
    const runs = {
      agent: await runCli(["scan", "--moment=agent", "--agent-path=apps/web/launch.json"], repo),
      "pre-commit": await runCli(["scan", "--moment=pre-commit", "--offline"], repo),
      pr: await runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo),
      release: await runCli(["scan", "--moment=release", "--unit=acme/web", `--revision=${head}`, "--artifact=dist/web.tgz", "--offline"], repo),
    };
    const seen = new Set();
    for (const [moment, r] of Object.entries(runs)) {
      assert.equal(r.code, 0, `${moment}: ${r.err}`);
      assert.equal(r.json.outcome.policyDeny, false, moment);
      assertWithinBudget(r.json, moment);
      for (const e of r.json.results) if (e.state === "evaluated") seen.add(e.control.id);
    }
    assert.deepEqual([...seen].sort(), ["app.minimum-supported-version", "search.input-rate", "web.module-announcement"]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
