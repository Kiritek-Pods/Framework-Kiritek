"use strict";

// T07: runtime aislado, presupuestos y cache segura.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runTool, isAlive, RUN_STATUS } = require("../../../src/engineering/guardrails/runtime/runner.js");
const { buildEnv } = require("../../../src/engineering/guardrails/runtime/sandbox.js");
const { createRunBudget, createPool, fallbackFor } = require("../../../src/engineering/guardrails/runtime/budget.js");
const { createObservationCache, keyFor } = require("../../../src/engineering/guardrails/runtime/cache.js");
const { activeTempDirs } = require("../../../src/engineering/guardrails/runtime/temp-cleanup.js");
const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
const { createObservation } = require("../../../src/engineering/guardrails/contracts/observation.js");
const P = require("../helpers/pipeline.js");

const NODE = process.execPath;
const POSIX = process.platform !== "win32";

function tmpRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-rt-")));
  fs.mkdirSync(path.join(dir, "apps", "web dir"), { recursive: true });
  return dir;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- T07.1 runner --------------------------------------------------------

test("T07.1 spawn sin shell, cwd confinado, entorno mínimo y temporal borrado", async () => {
  const repo = tmpRepo();
  try {
    const script = "console.log(JSON.stringify({cwd: process.cwd(), secret: process.env.GH_TOKEN || null, proxy: process.env.HTTPS_PROXY || null, tmp: process.env.TMPDIR, arg: process.argv[1]}))";
    const r = await runTool({
      command: NODE,
      args: ["-e", script, "; rm -rf / $(whoami)"],
      repoRoot: repo,
      cwd: "apps/web dir",
      sourceEnv: { PATH: process.env.PATH, GH_TOKEN: "ghp_secreto", HTTPS_PROXY: "http://proxy:3128" },
      timeoutMs: 10000,
    });
    assert.equal(r.status, RUN_STATUS.OK);
    const out = JSON.parse(r.stdout);
    assert.equal(fs.realpathSync(out.cwd), path.join(repo, "apps", "web dir"));
    assert.equal(out.secret, null, "credenciales no se heredan");
    assert.equal(out.proxy, null, "sin permiso de red no pasa proxy");
    assert.equal(out.arg, "; rm -rf / $(whoami)", "argumento literal, sin shell");
    assert.equal(r.tempCleaned, true);
    assert.equal(fs.existsSync(out.tmp), false, "temporal eliminado");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T07.1 cwd fuera del repo y credenciales no permitidas se rechazan sin dejar temporales", async () => {
  const repo = tmpRepo();
  try {
    const before = activeTempDirs().length;
    assert.throws(() => runTool({ command: NODE, args: ["-e", ""], repoRoot: repo, cwd: "../", timeoutMs: 1000 }), { code: "RUNTIME_CWD_OUTSIDE_REPO" });
    assert.throws(() => runTool({ command: NODE, args: ["-e", ""], repoRoot: repo, envAllowlist: ["NPM_TOKEN"], timeoutMs: 1000 }), { code: "RUNTIME_ENV_SECRET" });
    assert.equal(activeTempDirs().length, before);
    const env = buildEnv({ source: { NPM_TOKEN: "x", PATH: "/bin" }, allowlist: ["NPM_TOKEN"], permittedSecrets: ["NPM_TOKEN"] });
    assert.equal(env.NPM_TOKEN, "x", "sólo con permiso explícito");
    assert.equal(buildEnv({ source: { HTTPS_PROXY: "http://p" }, network: true }).HTTPS_PROXY, "http://p");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T07.1 exit distinto de cero, salida acotada y ejecutable inexistente", async () => {
  const repo = tmpRepo();
  try {
    const nz = await runTool({ command: NODE, args: ["-e", "process.exit(3)"], repoRoot: repo, timeoutMs: 30000 });
    assert.equal(nz.status, RUN_STATUS.NONZERO);
    assert.equal(nz.exitCode, 3);
    const big = await runTool({ command: NODE, args: ["-e", "process.stdout.write('x'.repeat(50000))"], repoRoot: repo, timeoutMs: 30000, maxOutputBytes: 1000 });
    assert.equal(big.stdout.length, 1000);
    assert.equal(big.truncated, true);
    const missing = await runTool({ command: "kiritek-no-existe-xyz", repoRoot: repo, timeoutMs: 30000 });
    assert.equal(missing.status, RUN_STATUS.SPAWN_ERROR);
    assert.equal(missing.tempCleaned, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T07.5 timeout mata el árbol de procesos completo", { skip: !POSIX && "árbol de procesos POSIX" }, async () => {
  const repo = tmpRepo();
  try {
    const script = `
      const { spawn } = require("child_process");
      const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      require("fs").writeSync(1, String(g.pid));
      setInterval(() => {}, 1000);
    `;
    // Margen amplio y escritura síncrona: bajo carga (suite en paralelo) el
    // hijo puede tardar en arrancar y en macOS los pipes son asíncronos.
    const r = await runTool({ command: NODE, args: ["-e", script], repoRoot: repo, timeoutMs: 5000 });
    assert.equal(r.status, RUN_STATUS.TIMEOUT);
    const grandchild = Number(r.stdout.trim());
    assert.ok(grandchild > 0, `pid del nieto: ${JSON.stringify(r.stdout)}`);
    for (let i = 0; i < 20 && (isAlive(r.pid) || isAlive(grandchild)); i += 1) await sleep(100);
    assert.equal(isAlive(r.pid), false, "hijo muerto");
    assert.equal(isAlive(grandchild), false, "nieto muerto (kill de árbol)");
    assert.equal(r.tempCleaned, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T07.1 límite de memoria mata el árbol con estado resource", async () => {
  const repo = tmpRepo();
  try {
    const r = await runTool({
      command: NODE,
      args: ["-e", "setInterval(() => {}, 1000)"],
      repoRoot: repo,
      timeoutMs: 10000,
      maxMemoryMb: 64,
      sampleRssMb: () => 4096,
      sampleIntervalMs: 20,
    });
    assert.equal(r.status, RUN_STATUS.RESOURCE);
    assert.ok(r.durationMs < 5000);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- T07.2 presupuestos --------------------------------------------------

test("T07.2 presupuesto de ejecución y pool de concurrencia", async () => {
  let t = 0;
  const b = createRunBudget({ totalMs: 1000, nowMs: () => t });
  assert.equal(b.allot(5000, 800), 800);
  t = 600;
  assert.equal(b.allot(5000, 800), 400);
  t = 1200;
  assert.equal(b.allot(5000), 0);
  assert.equal(b.exhausted(), true);

  const pool = createPool(2);
  let running = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      pool.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await sleep(10);
        running -= 1;
      })
    )
  );
  assert.equal(peak, 2);
  assert.throws(() => createPool(0));
  const ctl = P.resolveCatalog({ version: "1.0.0" }).catalog.controls[0];
  assert.equal(fallbackFor(ctl, "agent"), "defer-to-later-surface");
  assert.equal(fallbackFor(ctl, "pr"), "error-operational");
});

test("T07.2 presupuesto agotado ⇒ timeout explícito con fallback, nunca deny ni omisión", async () => {
  const env = P.environment();
  let t = 0;
  const { report } = await evaluateRun({
    ...env,
    controls: P.fakeControl(),
    clock: () => P.NOW,
    nowMs: () => (t += 700000),
    platformKey: "test-platform",
  });
  const e = P.envelopeOf(report);
  assert.equal(e.state, "timeout");
  assert.ok(e.diagnostics.some((d) => d.code === "BUDGET_EXHAUSTED"));
  assert.equal(e.result.decision, "error");
  assert.equal(report.outcome.policyDeny, false);
});

// --- T07.3 / T07.4 cache ---------------------------------------------------

function cacheEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-cache-"));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

async function runCached(cache, opts = {}) {
  const env = opts.env || P.environment(opts);
  let calls = 0;
  const controls = P.fakeControl({ collect: () => { calls += 1; return opts.observations || [P.burstObservation()]; } });
  const { report } = await evaluateRun({ ...env, controls, cache, clock: () => opts.now || P.NOW, platformKey: "test-platform" });
  return { report, calls, envelope: P.envelopeOf(report) };
}

test("T07.3 hit reutiliza observaciones sin recolectar y sin elevar confianza", async () => {
  const { root, done } = cacheEnv();
  try {
    const cache = createObservationCache({ root, clock: () => P.NOW });
    const first = await runCached(cache);
    assert.equal(first.calls, 1);
    assert.equal(first.envelope.cache, "miss");
    const second = await runCached(cache);
    assert.equal(second.calls, 0, "hit: no se vuelve a recolectar");
    assert.equal(second.envelope.cache, "hit");
    assert.equal(second.envelope.confidence, first.envelope.confidence);
    assert.equal(second.envelope.result.decision, first.envelope.result.decision);
    assert.deepEqual(second.envelope.result.findings, first.envelope.result.findings);
  } finally {
    done();
  }
});

test("T07.3 cualquier cambio de identidad (config, nivel, scope) produce miss", async () => {
  const { root, done } = cacheEnv();
  try {
    const cache = createObservationCache({ root, clock: () => P.NOW });
    await runCached(cache);
    const other = await runCached(cache, { level: "warn" });
    assert.equal(other.calls, 1, "configHash distinto ⇒ miss");
    const env = P.environment();
    const scope = JSON.parse(JSON.stringify(env.scope));
    scope.units[0].scopeHash = `sha256:${"9".repeat(64)}`;
    const moved = await runCached(cache, { env: { ...env, scope } });
    assert.equal(moved.calls, 1, "scopeHash distinto ⇒ miss");
    assert.throws(() => keyFor({ packId: "x" }), /incompleta/);
  } finally {
    done();
  }
});

test("T07.4 entrada corrupta, expirada o de otra identidad se invalida y recomputa", async () => {
  const { root, done } = cacheEnv();
  try {
    const cache = createObservationCache({ root, clock: () => P.NOW });
    await runCached(cache);
    const files = () => fs.readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith(".json")).map((f) => path.join(root, String(f)));
    const [file] = files();

    fs.writeFileSync(file, "{ roto");
    const corrupt = await runCached(cache);
    assert.equal(corrupt.calls, 1);
    assert.ok(corrupt.envelope.diagnostics.some((d) => d.code === "CACHE_CORRUPT"));

    const entry = JSON.parse(fs.readFileSync(files()[0], "utf8"));
    entry.observations[0].facts.requestsStarted = 0; // altera sin actualizar checksum
    fs.writeFileSync(files()[0], JSON.stringify(entry));
    assert.equal((await runCached(cache)).calls, 1, "checksum distinto ⇒ miss");

    const later = createObservationCache({ root, clock: () => "2026-10-20T00:00:00.000Z" });
    const expired = await runCached(later, { now: "2026-10-20T00:00:00.000Z" });
    assert.equal(expired.calls, 1);
    assert.ok(expired.envelope.diagnostics.some((d) => d.code === "CACHE_EXPIRED"));
  } finally {
    done();
  }
});

test("T07.4 observación cacheada de otra revisión no se acepta aunque el checksum sea válido", () => {
  const { root, done } = cacheEnv();
  try {
    const cache = createObservationCache({ root, clock: () => P.NOW });
    const parts = {
      packId: "engineering/guardrails", catalogDigest: `sha256:${"a".repeat(64)}`, controlId: P.CONTROL, controlVersion: "1.0.0", collectorVersions: "c@1.0.0", unitId: "acme/web",
      profileVersions: "search@1.0.0", revision: P.HEAD, scopeHash: `sha256:${"b".repeat(64)}`, inputManifestHash: `sha256:${"d".repeat(64)}`, configHash: `sha256:${"c".repeat(64)}`, platformKey: "p", momentContractVersion: "m",
    };
    const obs = createObservation({
      observationId: "obs/c/0", kind: "k", controlId: P.CONTROL, unitId: "acme/web", source: { collectorId: "c", version: "1.0.0", mechanism: "test" },
      revision: "fedcba9876543210fedcba9876543210fedcba98", scopeHash: parts.scopeHash, configHash: parts.configHash, catalogDigest: parts.catalogDigest,
      observedAt: P.NOW, status: "complete", confidence: "deterministic", evidenceClass: "deterministic", facts: {}, limitations: [], durationMs: 1, cache: "miss",
    });
    assert.equal(cache.set(parts, [obs], { ttlSeconds: 60 }).status, "written");
    const got = cache.get(parts);
    assert.equal(got.status, "miss");
    assert.equal(got.diagnostic.code, "CACHE_IDENTITY_MISMATCH");
  } finally {
    done();
  }
});

test("T07.4 sólo se cachean conjuntos completos", async () => {
  const { root, done } = cacheEnv();
  try {
    const cache = createObservationCache({ root, clock: () => P.NOW });
    const partial = [P.burstObservation(), P.burstObservation({ status: "partial", confidence: "medium", limitations: [{ code: "P", message: "p" }] })];
    await runCached(cache, { observations: partial });
    assert.equal(fs.readdirSync(root).length, 0);
    assert.equal((await runCached(cache, { observations: partial })).calls, 1);
  } finally {
    done();
  }
});

test("T07.5 disco lleno: la ejecución continúa y no quedan temporales ni locks", async () => {
  const { root, done } = cacheEnv();
  try {
    const failingFs = {
      ...fs,
      writeFileSync(file, data, opts) {
        if (String(file).endsWith(".tmp")) throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
        return fs.writeFileSync(file, data, opts);
      },
    };
    const cache = createObservationCache({ root, clock: () => P.NOW, fs: failingFs });
    const r = await runCached(cache);
    assert.equal(r.envelope.result.decision, "deny", "la decisión no depende de la cache");
    assert.ok(r.envelope.diagnostics.some((d) => d.code === "CACHE_DISK_FULL"));
    const leftovers = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => /\.(tmp|lock)$/.test(f));
    assert.deepEqual(leftovers, []);
  } finally {
    done();
  }
});

test("T07.5 carrera: lock vigente de otro dueño impide escribir; lock vencido se recupera", async () => {
  const { root, done } = cacheEnv();
  try {
    const writer = createObservationCache({ root, clock: () => P.NOW });
    await runCached(writer);
    const [file] = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith(".json")).map((f) => path.join(root, f));
    const entry = fs.readFileSync(file, "utf8");
    fs.rmSync(file);
    const lockFile = `${file}.lock`;
    fs.writeFileSync(lockFile, JSON.stringify({ owner: "otro", expiresAt: Date.now() + 60000 }));
    const contended = await runCached(createObservationCache({ root, clock: () => P.NOW }));
    assert.ok(contended.envelope.diagnostics.some((d) => d.code === "CACHE_LOCKED"));
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(lockFile, JSON.stringify({ owner: "otro", expiresAt: Date.now() - 1 }));
    await runCached(createObservationCache({ root, clock: () => P.NOW }));
    assert.equal(fs.existsSync(file), true, "lock vencido se recupera");
    assert.equal(fs.existsSync(lockFile), false);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).key, JSON.parse(entry).key);
  } finally {
    done();
  }
});

test("T07.5 offline: cache y runner no requieren red", async () => {
  const { root, done } = cacheEnv();
  try {
    const cache = createObservationCache({ root, clock: () => P.NOW });
    await runCached(cache);
    const offlineEnv = P.environment();
    const hit = await runCached(cache, { env: offlineEnv });
    assert.equal(hit.calls, 0);
    const env = buildEnv({ source: { HTTPS_PROXY: "http://p", PATH: "/bin" }, network: false });
    assert.equal(env.HTTPS_PROXY, undefined);
  } finally {
    done();
  }
});

test("T07.4 observación cacheada vencida por freshness del control ⇒ stale, sin deny", async () => {
  const { root, done } = cacheEnv();
  try {
    const writer = createObservationCache({ root, clock: () => P.NOW });
    await runCached(writer);
    // La cache aún considera vigente la entrada (su reloj está dentro del
    // TTL), pero la ejecución ocurre 25 h después: la observación supera
    // freshness.maxAgeSeconds (24 h) del control ⇒ stale.
    const reader = createObservationCache({ root, clock: () => "2026-10-05T12:00:01.000Z" });
    const r = await runCached(reader, { now: "2026-10-06T13:00:00.000Z" });
    assert.equal(r.calls, 0, "fue un hit");
    assert.equal(r.envelope.state, "stale");
    assert.equal(r.envelope.result.decision, "warn");
    assert.equal(r.envelope.blockingEligible, false);
  } finally {
    done();
  }
});
