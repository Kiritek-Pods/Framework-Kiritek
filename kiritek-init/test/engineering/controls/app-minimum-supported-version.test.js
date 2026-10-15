"use strict";

// T11: app.minimum-supported-version — contrato de política + harness conductual.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCatalogSession } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { resolveEngineeringConfig } = require("../../../src/engineering/guardrails/config/index.js");
const { resolveUnits } = require("../../../src/engineering/guardrails/workspace/units.js");
const { scopeHashFor } = require("../../../src/engineering/guardrails/workspace/scope.js");
const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
const { builtinControls } = require("../../../src/engineering/guardrails/controls/index.js");
const { runSuite, sanitize } = require("../../../src/engineering/guardrails/controls/app-minimum-supported-version/harness.js");
const { REQUIRED_SCENARIOS } = require("../../../src/engineering/guardrails/controls/app-minimum-supported-version/scenarios.js");
const { sweepArtifacts } = require("../../../src/engineering/guardrails/privacy/validate-output.js");
const { writeEvidence } = require("../../../src/engineering/guardrails/privacy/evidence-store.js");
const H = require("../helpers/catalogs.js");
const P = require("../helpers/pipeline.js");

const FIX = path.join(__dirname, "..", "fixtures", "version");
const CONTROL = "app.minimum-supported-version";
const CANARIES = ["KCANARY-device-1f2e", "KCANARY-account-9a8b", "KCANARY-store-7c6d"];

// Catálogo de prueba 1.2.0: el control admite enforce con suite aprobada (pr/release).
let enforceRoot = null;
function enforceCatalog() {
  if (!enforceRoot) {
    enforceRoot = H.tmpDir("kiritek-eng-amsv-cat-");
    H.writeCatalog(enforceRoot, H.buildFiles((d) => {
      d.version = "1.2.0";
      const ctl = d.controls.find((c) => c.id === CONTROL);
      ctl.supportedLevels = ["off", "warn", "enforce"];
      ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: "test/engineering/contract/app-minimum-supported-version", approvedVersion: "1.0.0", moments: ["pr", "release"] };
    }));
    process.on("exit", () => fs.rmSync(enforceRoot, { recursive: true, force: true }));
  }
  return { roots: [enforceRoot], approvedConformanceSuites: ["test/engineering/contract/app-minimum-supported-version@1.0.0"] };
}

function contractDoc(mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: CONTROL,
    versionScheme: "semver",
    environments: {
      production: { source: { kind: "remote-config", authenticity: "signature", keyId: "policy-k1" }, cacheTtlSeconds: 21600, staleIfOfflineSeconds: 86400, timeoutMs: 3000 },
    },
    offline: { firstRun: "allow-with-warning", expiredCache: "allow-with-warning" },
    grace: { allowed: true, timeSource: "server", maxDays: 14, audience: "all" },
    hard: { explainReason: true, exitWhenStoreUnavailable: "fallback-link" },
    soft: { allowContinue: true, postponeFrequencyHours: 24 },
    stores: [
      { platform: "ios", store: "app-store", fallback: "web-download" },
      { platform: "android", store: "play-store", fallback: "web-download" },
    ],
    rollback: { mechanism: "remote-policy-revert", requiresAppRelease: false },
    override: { authenticated: true, scopedBy: ["environment", "audience"], maxDurationHours: 24, audited: true, reversible: true },
    observability: { events: ["fetch", "parse", "cache", "decision", "store", "override"], identifiers: "pseudonymous" },
    harness: { kind: "node-adapter", adapter: "apps/mobile/gate.adapter.js" },
  };
  mutate(doc);
  return doc;
}

async function runVersion({ adapter = "good", contract = contractDoc(), level = "warn", enforce = false, noContract = false, files = {}, rawContract } = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-amsv-")));
  try {
    fs.mkdirSync(path.join(repo, "apps", "mobile"), { recursive: true });
    fs.writeFileSync(path.join(repo, "apps/mobile/good.adapter.js"), fs.readFileSync(path.join(FIX, "good.adapter.js.fixture")));
    if (adapter) fs.writeFileSync(path.join(repo, "apps/mobile/gate.adapter.js"), fs.readFileSync(path.join(FIX, `${adapter}.adapter.js.fixture`)));
    if (!noContract) fs.writeFileSync(path.join(repo, "apps/mobile/version-policy.json"), rawContract !== undefined ? rawContract : JSON.stringify(contract));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content);
    }
    const catalog = enforce ? "1.2.0" : "1.0.0";
    const document = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog },
      workspace: {
        units: [
          {
            id: "acme/mobile",
            root: "apps/mobile",
            kind: "application",
            profiles: [{ id: "mobile-app", version: "1.0.0" }],
            owns: ["apps/mobile/**"],
            controls: { [CONTROL]: { level, ...(noContract ? {} : { parameters: { policyContract: "apps/mobile/version-policy.json" } }) } },
          },
        ],
      },
    };
    const session = createCatalogSession(enforce ? enforceCatalog() : {});
    const resolvedConfig = resolveEngineeringConfig({ document, env: {}, repoRoot: repo, catalogSession: session });
    const catalogSnapshot = session.snapshot;
    const resolvedUnits = resolveUnits(resolvedConfig, catalogSnapshot, { repoRoot: repo });
    const unitScope = { unitId: "acme/mobile", coverage: "direct", reasons: ["owns:apps/mobile/**"], paths: ["apps/mobile/lib/gate.dart"] };
    const scope = { moment: "pr", revision: P.HEAD, baseRevision: P.BASE, units: [{ ...unitScope, scopeHash: scopeHashFor({ moment: "pr", revision: P.HEAD, baseRevision: P.BASE, unit: unitScope }) }], diagnostics: [] };
    const out = await evaluateRun({ moment: "pr", resolvedConfig, catalogSnapshot, resolvedUnits, scope, controls: builtinControls(), repoRoot: repo, clock: () => P.NOW, platformKey: "test-platform", canaries: CANARIES });
    return { ...out, envelope: out.report.results.find((e) => e.control.id === CONTROL), repo };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const rules = (e) => [...new Set((e.result ? e.result.findings : []).map((f) => f.ruleId.split("/")[1]))].sort();

function loadAdapter(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-amsv-mod-"));
  fs.writeFileSync(path.join(dir, "good.adapter.js"), fs.readFileSync(path.join(FIX, "good.adapter.js.fixture")));
  fs.writeFileSync(path.join(dir, "gate.js"), fs.readFileSync(path.join(FIX, `${name}.adapter.js.fixture`)));
  return require(path.join(dir, "gate.js")).createVersionGateUnderTest;
}

const PARAMS = { environment: "production", cacheTtlSeconds: 21600, staleIfOfflineSeconds: 86400, timeoutMs: 3000, platform: "ios", enterprise: false };

// --- T11.1 contrato --------------------------------------------------------

test("T11.1 contrato completo + implementación correcta ⇒ allow con 21 escenarios", async () => {
  const { envelope, evidence } = await runVersion();
  assert.equal(envelope.result.decision, "allow", JSON.stringify(envelope.result));
  assert.equal(envelope.evidenceClass, "deterministic");
  assert.equal(envelope.evidenceCompleteness, "complete");
  assert.equal(evidence[0].observationRefs.length, 1 + REQUIRED_SCENARIOS.length);
});

test("T11.1 reglas semánticas del contrato producen findings deterministas nombrados", async () => {
  const cases = {
    "contract-source-authenticity": (d) => (d.environments.production.source.authenticity = "none"),
    "contract-environments": (d) => {
      d.environments.staging = d.environments.production;
      delete d.environments.production;
    },
    "contract-timeout": (d) => (d.environments.production.timeoutMs = 10000),
    "contract-cache": (d) => (d.environments.production.staleIfOfflineSeconds = 999999),
    "contract-offline": (d) => (d.offline.firstRun = "block-with-explanation"),
    "contract-grace": (d) => (d.grace.timeSource = "local"),
    "contract-hard-exit": (d) => (d.hard.exitWhenStoreUnavailable = "none"),
    "contract-soft": (d) => (d.soft.allowContinue = false),
    "contract-store-fallback": (d) => (d.stores[0].fallback = "none"),
    "contract-rollback": (d) => (d.environments.production.source.kind = "bundled"),
    "contract-override": (d) => (d.override.audited = false),
    "contract-observability": (d) => (d.observability.identifiers = "raw"),
  };
  for (const [rule, mutate] of Object.entries(cases)) {
    const { envelope } = await runVersion({ contract: contractDoc(mutate) });
    assert.ok(rules(envelope).includes(rule), `${rule}: ${rules(envelope)}`);
    const f = envelope.result.findings.find((x) => x.ruleId.endsWith(`/${rule}`));
    assert.equal(f.path, "apps/mobile/version-policy.json");
    assert.ok(envelope.findingEvidence.find((x) => x.fingerprint === f.fingerprint).evidenceClass === "deterministic");
  }
});

test("T11.1 contrato ausente/ilegible/inválido es determinista (candidato a bloqueo)", async () => {
  for (const rawContract of ["{ roto", JSON.stringify({ schemaVersion: 1, control: CONTROL })]) {
    const { envelope } = await runVersion({ rawContract });
    assert.deepEqual(rules(envelope), ["contract-invalid"]);
    assert.equal(envelope.result.decision, "warn", "en warn sólo avisa");
  }
  const enforced = await runVersion({ rawContract: "{ roto", level: "enforce", enforce: true });
  assert.equal(enforced.envelope.result.decision, "deny");
  assert.equal(enforced.envelope.blockingEligible, true);
});

// --- T11.2 comparación ----------------------------------------------------

test("T11.2 semver: menor/igual/mayor, prerelease, build metadata y trampa lexicográfica", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  const byId = Object.fromEntries(good.scenarios.map((s) => [s.id, s.decisions[0].action]));
  assert.deepEqual(
    { below: byId["below-min"], equal: byId["equal-min"], above: byId["above-min"], pre: byId["prerelease-below"], build: byId["build-metadata"], lex: byId.lexicographic },
    { below: "hard", equal: "none", above: "none", pre: "hard", build: "none", lex: "none" }
  );
  const { envelope } = await runVersion({ adapter: "lexicographic" });
  assert.deepEqual(rules(envelope), ["version-comparison"]);
  const fps = envelope.result.findings.map((f) => f.fingerprint);
  assert.ok(fps.includes("amsv:version-comparison:lexicographic"));
  assert.ok(fps.includes("amsv:version-comparison:prerelease-below"));
});

test("T11.2 payload o firma inválidos nunca se aplican", async () => {
  const { envelope } = await runVersion({ adapter: "trust-payload" });
  assert.ok(rules(envelope).includes("untrusted-payload"));
  assert.ok(envelope.result.findings.some((f) => f.fingerprint === "amsv:untrusted-payload:invalid-signature"));
});

// --- T11.3 hard / soft ------------------------------------------------------

test("T11.3 hard update accesible y sin loop; store ausente ⇒ fallback y salida", async () => {
  const { envelope } = await runVersion({ adapter: "trap-user" });
  assert.deepEqual(rules(envelope), ["store-fallback"]);
  const good = await runSuite(loadAdapter("good"), PARAMS);
  const hard = good.scenarios.find((s) => s.id === "below-min").decisions[0];
  assert.deepEqual([hard.canContinue, hard.explanationAccessible, hard.exitAvailable, hard.updateTarget], [false, true, true, "store"]);
  const soft = good.scenarios.find((s) => s.id === "soft").decisions[0];
  assert.deepEqual([soft.action, soft.canContinue, soft.canPostpone], ["soft", true, true]);
});

// --- T11.4 offline, tiempo confiable y gracia --------------------------------

test("T11.4 offline: primera ejecución, cache válida y expirada según el contrato", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  const d = (id) => good.scenarios.find((s) => s.id === id).decisions[0];
  assert.deepEqual([d("offline-first-run").action, d("offline-first-run").canContinue], ["none", true]);
  assert.deepEqual([d("offline-valid-cache").action, d("offline-valid-cache").policySource], ["hard", "cache"]);
  assert.deepEqual([d("offline-expired-cache").action, d("offline-expired-cache").canContinue], ["none", true]);
  assert.ok(d("timeout").settled && d("timeout").settledAt <= 3000 + 1000, "resuelve dentro del timeout");
  // Si el contrato declara bloquear en cache expirada, la implementación que permite continuar incumple.
  const { envelope } = await runVersion({ contract: contractDoc((c) => (c.offline.expiredCache = "block-with-explanation")) });
  assert.ok(envelope.result.findings.some((f) => f.fingerprint === "amsv:offline-policy:offline-expired-cache"));
});

test("T11.4 sin timeout la obtención queda colgada ⇒ finding de timeout (reloj virtual, determinista)", async () => {
  const { envelope } = await runVersion({ adapter: "no-timeout" });
  assert.ok(rules(envelope).includes("timeout"));
  assert.equal(envelope.evidenceClass, "deterministic");
});

test("T11.4 gracia: vigente ⇒ soft; vencida por tiempo del servidor aunque el reloj local diga lo contrario ⇒ hard", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  assert.equal(good.scenarios.find((s) => s.id === "grace-active").decisions[0].action, "soft");
  assert.equal(good.scenarios.find((s) => s.id === "grace-local-clock").decisions[0].action, "hard");
  const { envelope } = await runVersion({ adapter: "local-clock" });
  assert.deepEqual(rules(envelope), ["grace"]);
  assert.ok(envelope.result.findings.some((f) => f.fingerprint === "amsv:grace:grace-local-clock"));
});

// --- T11.5 stores, rollback, override ----------------------------------------

test("T11.5 enterprise, rollback sin publicar app y overrides gobernados", async () => {
  const enterprise = contractDoc((c) => c.stores.push({ platform: "enterprise", store: "mdm", fallback: "support-contact" }));
  const ent = await runVersion({ contract: enterprise });
  assert.equal(ent.envelope.result.decision, "allow");
  const good = await runSuite(loadAdapter("good"), { ...PARAMS, enterprise: true });
  assert.equal(good.scenarios.find((s) => s.id === "enterprise-store").decisions[0].updateTarget, "enterprise");
  const rb = good.scenarios.find((s) => s.id === "rollback").decisions.map((d) => d.action);
  assert.deepEqual(rb, ["hard", "none"], "revertir la política levanta el bloqueo sin cambiar la versión instalada");
  const ov = Object.fromEntries(good.scenarios.filter((s) => s.id.startsWith("override")).map((s) => [s.id, s.decisions[0].action]));
  assert.deepEqual(ov, { "override-valid": "none", "override-expired": "hard", "override-unauthenticated": "hard", "override-other-environment": "hard" });
  const { envelope } = await runVersion({ adapter: "ignore-overrides" });
  assert.deepEqual(rules(envelope), ["override"]);
});

// --- T11.6 indisponibilidad remota ------------------------------------------

test("T11.6 fuente remota inaccesible durante el análisis ⇒ indisponible/operativo, nunca deny", async () => {
  const files = { "apps/mobile/remote-offline.js": fs.readFileSync(path.join(FIX, "remote-offline.js.fixture")) };
  const contract = contractDoc((c) => (c.harness = { kind: "trace-command", command: "node", args: ["remote-offline.js"], traceFile: "apps/mobile/out/version-trace.json" }));
  const { envelope, report } = await runVersion({ contract, files, level: "enforce", enforce: true });
  assert.ok(envelope.diagnostics.some((d) => d.code === "REMOTE_UNAVAILABLE"));
  assert.notEqual(envelope.result && envelope.result.decision, "deny");
  assert.equal(envelope.blockingEligible, false);
  assert.equal(report.outcome.policyDeny, false);
});

test("T11.6 adapter que falla o sin contrato ⇒ nunca deny", async () => {
  const thrown = await runVersion({ adapter: "throws", level: "enforce", enforce: true });
  assert.equal(thrown.report.outcome.policyDeny, false);
  assert.ok(thrown.envelope.diagnostics.some((d) => d.code === "ADAPTER_INIT_FAILED"));
  const none = await runVersion({ noContract: true, level: "enforce", enforce: true, files: { "apps/mobile/lib/gate.dart": "final forceUpdate = remoteConfig.getString('min_supported');" } });
  assert.equal(none.envelope.result.decision, "warn");
  assert.equal(none.envelope.evidenceClass, "heuristic");
  assert.equal(none.envelope.result.findings[0].path, "apps/mobile/lib/gate.dart");
  assert.equal(none.report.outcome.policyDeny, false);
});

// --- T11.7 gate -------------------------------------------------------------

test("T11.7 gate: harness reproducible con transporte inyectado", async () => {
  const factory = loadAdapter("good");
  assert.deepEqual(await runSuite(factory, PARAMS), await runSuite(factory, PARAMS));
  const a = await runVersion({ adapter: "lexicographic", level: "enforce", enforce: true });
  const b = await runVersion({ adapter: "lexicographic", level: "enforce", enforce: true });
  assert.equal(a.envelope.result.decision, "deny");
  assert.equal(a.envelope.blockingEligible, true);
  assert.deepEqual(a.envelope.result.findings.map((f) => f.fingerprint), b.envelope.result.findings.map((f) => f.fingerprint));
  const warn = await runVersion({ adapter: "lexicographic", level: "warn" });
  assert.equal(warn.envelope.result.decision, "warn");
  assert.equal(warn.report.outcome.policyDeny, false);
});

test("T11.7 gate: ningún token de dispositivo/cuenta/store queda en traza, reporte ni evidencia", async () => {
  assert.deepEqual(sanitize({ action: "hard", deviceToken: "x", canContinue: "sí" }), { action: "hard", droppedFields: 2 });
  const trace = await runSuite(loadAdapter("leaky"), PARAMS);
  assert.deepEqual(sweepArtifacts({ trace: JSON.stringify(trace) }, { canaries: CANARIES }), []);
  const { envelope, report, evidence } = await runVersion({ adapter: "leaky" });
  assert.equal(envelope.result.decision, "allow", "los campos extra se descartan sin afectar la decisión");
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-amsv-ev-")));
  try {
    for (const ev of evidence) writeEvidence({ repoRoot: repo, directory: ".kiritek/evidence/engineering", evidence: ev, canaries: CANARIES });
    const files = {};
    for (const f of fs.readdirSync(repo, { recursive: true }).map(String)) {
      if (fs.statSync(path.join(repo, f)).isFile()) files[f] = fs.readFileSync(path.join(repo, f), "utf8");
    }
    assert.deepEqual(sweepArtifacts({ report: JSON.stringify(report), ...files }, { canaries: CANARIES }), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
