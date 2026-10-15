"use strict";

// T12: web.module-announcement — launch manifest + harness conductual.

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
const { runSuite, contrastRatio } = require("../../../src/engineering/guardrails/controls/web-module-announcement/harness.js");
const { REQUIRED_SCENARIOS } = require("../../../src/engineering/guardrails/controls/web-module-announcement/scenarios.js");
const { sweepArtifacts } = require("../../../src/engineering/guardrails/privacy/validate-output.js");
const { writeEvidence } = require("../../../src/engineering/guardrails/privacy/evidence-store.js");
const H = require("../helpers/catalogs.js");
const P = require("../helpers/pipeline.js");

const FIX = path.join(__dirname, "..", "fixtures", "announcement");
const CONTROL = "web.module-announcement";
const MANIFEST = "apps/web/launch.json";
const CANARIES = ["KCANARY-mail-3b4c", "KCANARY-user-5d6e", "KCANARY-track-7f80"];

// Catálogo de prueba 1.2.0: el control admite enforce con suite aprobada (pr/release).
let enforceRoot = null;
function enforceCatalog() {
  if (!enforceRoot) {
    enforceRoot = H.tmpDir("kiritek-eng-wma-cat-");
    H.writeCatalog(enforceRoot, H.buildFiles((d) => {
      d.version = "1.2.0";
      const ctl = d.controls.find((c) => c.id === CONTROL);
      ctl.supportedLevels = ["off", "warn", "enforce"];
      ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: "test/engineering/contract/web-module-announcement", approvedVersion: "1.0.0", moments: ["pr", "release"] };
    }));
    process.on("exit", () => fs.rmSync(enforceRoot, { recursive: true, force: true }));
  }
  return { roots: [enforceRoot], approvedConformanceSuites: ["test/engineering/contract/web-module-announcement@1.0.0"] };
}

function manifestDoc(mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: CONTROL,
    modules: [
      { moduleId: "reports", announcementRequired: true, announcementId: "ann-reports" },
      { moduleId: "internal-tools", announcementRequired: true, governedNaRef: "na-internal-tools" },
      { moduleId: "settings-v2", announcementRequired: false },
    ],
    announcements: [
      {
        id: "ann-reports",
        version: 1,
        window: { start: "2026-09-01T00:00:00Z", end: "2026-12-01T00:00:00Z" },
        owner: "team-reports",
        audiences: [
          { id: "admins", criteria: [{ attribute: "role", operator: "in", values: ["admin", "owner"] }], channels: ["in-app"], fallbackChannel: "release-notes" },
          { id: "pro-plan", criteria: [{ attribute: "plan", operator: "in", values: ["pro"] }], channels: ["release-notes"] },
        ],
        channels: ["in-app", "release-notes"],
        content: { titleRef: "reports.announce.title", bodyRef: "reports.announce.body", locales: ["en", "es"], defaultLocale: "en", missingContent: "generic-text" },
        showOnce: { key: "ann-reports-v1", audienceScope: "user", periodDays: 30, storageUnavailable: "once-per-session" },
        rollout: { state: "active", history: [{ state: "draft", at: "2026-08-20T00:00:00Z", by: "team-reports", reason: "borrador" }, { state: "active", at: "2026-09-01T00:00:00Z", by: "team-reports", reason: "lanzamiento" }] },
        presentation: { animated: true },
      },
    ],
    governedNa: [{ ref: "na-internal-tools", moduleId: "internal-tools", reason: "Uso interno, sin audiencia externa", scope: "apps/web/internal-tools", reviewBy: "2027-01-01T00:00:00Z", approval: { by: "web-leads", ref: "ADR-42" } }],
    harness: { kind: "node-adapter", adapter: "apps/web/announce.adapter.js" },
  };
  mutate(doc);
  return doc;
}

async function runAnnouncement({ adapter = "good", manifest = manifestDoc(), level = "warn", enforce = false, noManifest = false, rawManifest, paths = ["apps/web/src/modules/reports/index.tsx"] } = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-wma-")));
  try {
    fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
    fs.writeFileSync(path.join(repo, "apps/web/good.adapter.js"), fs.readFileSync(path.join(FIX, "good.adapter.js.fixture")));
    if (adapter) fs.writeFileSync(path.join(repo, "apps/web/announce.adapter.js"), fs.readFileSync(path.join(FIX, `${adapter}.adapter.js.fixture`)));
    if (!noManifest) fs.writeFileSync(path.join(repo, MANIFEST), rawManifest !== undefined ? rawManifest : JSON.stringify(manifest));
    const document = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog: enforce ? "1.2.0" : "1.0.0" },
      workspace: {
        units: [
          {
            id: "acme/web",
            root: "apps/web",
            kind: "application",
            profiles: [
              { id: "web", version: "1.0.0" },
              { id: "module-launch", version: "1.0.0" },
            ],
            owns: ["apps/web/**"],
            controls: { [CONTROL]: { level, ...(noManifest ? {} : { parameters: { launchManifest: MANIFEST } }) } },
          },
        ],
      },
    };
    const session = createCatalogSession(enforce ? enforceCatalog() : {});
    const resolvedConfig = resolveEngineeringConfig({ document, env: {}, repoRoot: repo, catalogSession: session });
    const catalogSnapshot = session.snapshot;
    const resolvedUnits = resolveUnits(resolvedConfig, catalogSnapshot, { repoRoot: repo });
    const unitScope = { unitId: "acme/web", coverage: "direct", reasons: ["owns:apps/web/**"], paths };
    const scope = { moment: "pr", revision: P.HEAD, baseRevision: P.BASE, units: [{ ...unitScope, scopeHash: scopeHashFor({ moment: "pr", revision: P.HEAD, baseRevision: P.BASE, unit: unitScope }) }], diagnostics: [] };
    const out = await evaluateRun({ moment: "pr", resolvedConfig, catalogSnapshot, resolvedUnits, scope, controls: builtinControls(), repoRoot: repo, clock: () => P.NOW, platformKey: "test-platform", canaries: CANARIES });
    return { ...out, envelope: out.report.results.find((e) => e.control.id === CONTROL) };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const rules = (e) => [...new Set((e.result ? e.result.findings : []).map((f) => f.ruleId.split("/")[1]))].sort();
const fps = (e) => (e.result ? e.result.findings : []).map((f) => f.fingerprint);

function loadAdapter(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-wma-mod-"));
  fs.writeFileSync(path.join(dir, "good.adapter.js"), fs.readFileSync(path.join(FIX, "good.adapter.js.fixture")));
  fs.writeFileSync(path.join(dir, "under-test.js"), fs.readFileSync(path.join(FIX, `${name}.adapter.js.fixture`)));
  return require(path.join(dir, "under-test.js")).createAnnouncementUnderTest;
}

const PARAMS = { audienceScope: "user", periodDays: 30, storageUnavailable: "once-per-session", missingContent: "generic-text", animated: true, contrastMin: 4.5 };
const steps = (trace, id) => trace.scenarios.find((s) => s.id === id).steps;

// --- T12.1 señal explícita ----------------------------------------------------

test("T12.1 manifest completo + implementación correcta ⇒ allow con 19 escenarios y N/A vigente", async () => {
  const { envelope, evidence } = await runAnnouncement();
  assert.equal(envelope.result.decision, "allow", JSON.stringify(envelope.result));
  assert.match(envelope.result.reason, /N\/A gobernado/);
  assert.equal(envelope.evidenceClass, "deterministic");
  assert.equal(envelope.evidenceCompleteness, "complete");
  assert.equal(evidence[0].observationRefs.length, 1 + REQUIRED_SCENARIOS.length);
});

test("T12.1 sin manifest: inferencia por ruta sólo sugiere confirmar (heurística, nunca deny)", async () => {
  const inferred = await runAnnouncement({ noManifest: true, level: "enforce", enforce: true });
  assert.equal(inferred.envelope.result.decision, "warn");
  assert.equal(inferred.envelope.evidenceClass, "heuristic");
  assert.deepEqual(rules(inferred.envelope), ["launch-confirmation"]);
  assert.equal(inferred.envelope.result.findings[0].path, "apps/web/src/modules/reports/index.tsx");
  assert.equal(inferred.report.outcome.policyDeny, false);
  const none = await runAnnouncement({ noManifest: true, paths: ["apps/web/src/util/date.ts"] });
  assert.equal(none.envelope.result.decision, "warn");
  assert.match(none.envelope.result.reason, /launch manifest/);
});

test("T12.1 módulo que exige anuncio sin señal (o con anuncio inexistente) ⇒ required-signal-missing determinista", async () => {
  const { envelope } = await runAnnouncement({
    manifest: manifestDoc((d) => {
      d.modules.push({ moduleId: "billing", announcementRequired: true });
      d.modules.push({ moduleId: "exports", announcementRequired: true, announcementId: "ann-missing" });
    }),
  });
  assert.deepEqual(rules(envelope), ["required-signal-missing"]);
  assert.deepEqual(fps(envelope).sort(), ["wma:required-signal-missing:billing", "wma:required-signal-missing:exports"]);
  const f = envelope.result.findings[0];
  assert.equal(f.path, MANIFEST);
  assert.equal(envelope.findingEvidence.find((x) => x.fingerprint === f.fingerprint).evidenceClass, "deterministic");
  assert.equal(envelope.result.decision, "warn", "en warn sólo avisa");
});

test("T12.1 N/A gobernado inválido: inexistente, de otro módulo, vencido o alta criticidad sin segunda aprobación", async () => {
  const cases = [
    (d) => (d.modules[1].governedNaRef = "na-otro"),
    (d) => (d.governedNa[0].moduleId = "reports"),
    (d) => (d.governedNa[0].reviewBy = "2026-01-01T00:00:00Z"),
    (d) => (d.governedNa[0].criticality = "high"),
  ];
  for (const mutate of cases) {
    const { envelope } = await runAnnouncement({ manifest: manifestDoc(mutate) });
    assert.deepEqual(rules(envelope), ["invalid-na"], String(mutate));
  }
  const approved = await runAnnouncement({ manifest: manifestDoc((d) => Object.assign(d.governedNa[0], { criticality: "high", approval: { by: "web-leads", ref: "ADR-42", secondBy: "security" } })) });
  assert.equal(approved.envelope.result.decision, "allow");
});

// --- T12.2 metadata -------------------------------------------------------------

test("T12.2 manifest ilegible, schema inválido o ids duplicados ⇒ metadata-invalid (candidato a bloqueo)", async () => {
  const raw = [
    "{ roto",
    JSON.stringify(manifestDoc((d) => delete d.announcements[0].owner)),
    JSON.stringify(manifestDoc((d) => delete d.announcements[0].showOnce.storageUnavailable)),
    JSON.stringify(manifestDoc((d) => (d.announcements[0].rollout.state = "live"))),
    JSON.stringify(manifestDoc((d) => d.modules.push({ ...d.modules[0] }))),
  ];
  for (const rawManifest of raw) {
    const { envelope } = await runAnnouncement({ rawManifest });
    assert.deepEqual(rules(envelope), ["metadata-invalid"], rawManifest.slice(0, 40));
  }
  const enforced = await runAnnouncement({ rawManifest: "{ roto", level: "enforce", enforce: true });
  assert.equal(enforced.envelope.result.decision, "deny");
  assert.equal(enforced.envelope.blockingEligible, true);
});

test("T12.2 reglas semánticas: ventana, locale por defecto, clave show-once y trazabilidad de rollout", async () => {
  const cases = {
    window: (d) => (d.announcements[0].window.end = "2026-08-01T00:00:00Z"),
    "content-localization": (d) => (d.announcements[0].content.defaultLocale = "pt"),
    "show-once-key": (d) => d.announcements.push({ ...JSON.parse(JSON.stringify(d.announcements[0])), id: "ann-reports-b" }),
    "rollout-traceability": (d) => (d.announcements[0].rollout.state = "paused"),
  };
  for (const [rule, mutate] of Object.entries(cases)) {
    const { envelope } = await runAnnouncement({ manifest: manifestDoc(mutate) });
    assert.ok(rules(envelope).includes(rule), `${rule}: ${rules(envelope)}`);
  }
  const unordered = await runAnnouncement({ manifest: manifestDoc((d) => d.announcements[0].rollout.history.unshift({ state: "active", at: "2026-10-01T00:00:00Z", by: "x", reason: "r" })) });
  assert.ok(rules(unordered.envelope).includes("rollout-traceability"), "historial desordenado");
});

// --- T12.3 audiencias y canales -----------------------------------------------------

test("T12.3 audiencias sin PII: atributo no permitido o valores con email/teléfono ⇒ audience-pii", async () => {
  const cases = [
    (d) => (d.announcements[0].audiences[0].criteria[0] = { attribute: "email", operator: "in", values: ["dominio"] }),
    (d) => (d.announcements[0].audiences[1].criteria[0].values = ["ana@example.test"]),
    (d) => (d.announcements[0].audiences[1].criteria[0] = { attribute: "cohort", operator: "in", values: ["+56 9 1234 5678"] }),
  ];
  for (const mutate of cases) {
    const { envelope, report } = await runAnnouncement({ manifest: manifestDoc(mutate) });
    assert.deepEqual(rules(envelope), ["audience-pii"]);
    assert.ok(!JSON.stringify(report).includes("ana@example.test"), "los valores de criterios no se copian a la evidencia");
  }
});

test("T12.3 canales soportados y alcanzables por audiencia; fallback explícito los rescata", async () => {
  const unsupported = await runAnnouncement({ manifest: manifestDoc((d) => d.announcements[0].channels.push("sms")) });
  assert.deepEqual(rules(unsupported.envelope), ["channels-unsupported"]);
  const unreachable = await runAnnouncement({
    manifest: manifestDoc((d) => {
      d.announcements[0].channels = ["in-app"];
      d.announcements[0].audiences[1].channels = [];
    }),
  });
  assert.deepEqual(rules(unreachable.envelope), ["channel-unreachable"]);
  const rescued = await runAnnouncement({
    manifest: manifestDoc((d) => {
      d.announcements[0].channels = ["in-app"];
      d.announcements[0].audiences[1].channels = [];
      d.announcements[0].audiences[1].fallbackChannel = "in-app";
    }),
  });
  assert.equal(rescued.envelope.result.decision, "allow");
});

// --- T12.4 show-once y rollout ------------------------------------------------------

test("T12.4 show-once: repetición, storage borrado, periodo y alcance según política", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  assert.deepEqual(steps(good, "repeat-visit").map((s) => s.visible), [true, false]);
  assert.deepEqual(steps(good, "storage-cleared").map((s) => s.visible), [true, true, false]);
  assert.deepEqual(steps(good, "period-elapsed").map((s) => s.visible), [true, false, true]);
  assert.deepEqual(steps(good, "other-viewer").map((s) => s.visible), [true, true]);
  const device = await runSuite(loadAdapter("good"), { ...PARAMS, audienceScope: "device" });
  assert.deepEqual(steps(device, "other-viewer").map((s) => s.visible), [true, false]);
  const { envelope } = await runAnnouncement({ adapter: "no-dedupe" });
  assert.deepEqual(rules(envelope), ["show-once"]);
  assert.ok(fps(envelope).includes("wma:show-once:repeat-visit"));
});

test("T12.4 storage no disponible: tratamiento declarado y el módulo nunca se rompe", async () => {
  const expected = { suppress: [false, false, false], "once-per-session": [true, false, true], show: [true, true, true] };
  for (const [policy, visible] of Object.entries(expected)) {
    const t = await runSuite(loadAdapter("good"), { ...PARAMS, storageUnavailable: policy });
    assert.deepEqual(steps(t, "storage-unavailable").map((s) => s.visible), visible, policy);
  }
  const suppress = await runAnnouncement({ manifest: manifestDoc((d) => (d.announcements[0].showOnce.storageUnavailable = "suppress")) });
  assert.equal(suppress.envelope.result.decision, "allow");
  const { envelope } = await runAnnouncement({ adapter: "storage-crash" });
  assert.deepEqual(fps(envelope), ["wma:show-once:storage-unavailable"]);
});

test("T12.4 rollout pausado/retirado oculta el anuncio sin retirar el módulo; reactivar vuelve a mostrar", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  assert.deepEqual(steps(good, "rollout-paused").map((s) => [s.visible, s.moduleAvailable]), [[false, true], [true, true]]);
  assert.deepEqual(steps(good, "rollout-retired").map((s) => [s.visible, s.moduleAvailable]), [[false, true]]);
  const { envelope } = await runAnnouncement({ adapter: "retire-hides-module" });
  assert.deepEqual(rules(envelope), ["rollout"]);
  const paused = manifestDoc((d) => {
    d.announcements[0].rollout.history.push({ state: "paused", at: "2026-09-20T00:00:00Z", by: "team-reports", reason: "incidente" });
    d.announcements[0].rollout.state = "paused";
  });
  const ok = await runAnnouncement({ manifest: paused });
  assert.equal(ok.envelope.result.decision, "allow", "rollout pausado válido ⇒ allow");
  const retired = manifestDoc((d) => {
    d.announcements[0].rollout.history.push({ state: "retired", at: "2026-09-20T00:00:00Z", by: "team-reports", reason: "fin" });
    d.announcements[0].rollout.state = "retired";
  });
  const r = await runAnnouncement({ manifest: retired, adapter: null });
  assert.equal(r.envelope.result.decision, "allow", "retirado: sin tests exigidos");
});

// --- T12.5 accesibilidad --------------------------------------------------------------

test("T12.5 teclado, foco, nombre/rol/estado, cierre, contraste y reduced motion", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  const one = (id) => steps(good, id)[0];
  assert.deepEqual([one("keyboard").keyboardReachable, one("keyboard").tabVisitsAll], [true, true]);
  assert.equal(one("focus").focusOnOpen, true);
  assert.deepEqual([one("close").escapeCloses, one("close").focusReturns, one("close").closeControl], [true, true, true]);
  assert.ok(one("contrast").contrastRatio >= 4.5);
  assert.equal(one("reduced-motion").reducedMotionOk, true);
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.ok(contrastRatio("#9a9a9a", "#ffffff") < 4.5);
  const defects = { "mouse-only": "keyboard", "trap-escape": "close", unnamed: "name-role-state", "low-contrast": "contrast", "no-reduced-motion": "reduced-motion" };
  for (const [adapter, rule] of Object.entries(defects)) {
    const { envelope } = await runAnnouncement({ adapter });
    assert.deepEqual(rules(envelope), [rule], adapter);
  }
});

// --- T12.6 contenido y localización -----------------------------------------------------

test("T12.6 fallback de localización y contenido: nunca claves internas, vacío ni markup roto", async () => {
  const good = await runSuite(loadAdapter("good"), PARAMS);
  assert.equal(steps(good, "locale-fallback")[0].textState, "default-locale");
  assert.equal(steps(good, "missing-content")[0].textState, "fallback-text");
  assert.equal(steps(good, "broken-markup")[0].textState, "expected-locale");
  const hide = await runSuite(loadAdapter("good"), { ...PARAMS, missingContent: "hide" });
  assert.equal(steps(hide, "missing-content")[0].visible, false);
  const keys = await runAnnouncement({ adapter: "raw-keys" });
  assert.deepEqual(rules(keys.envelope), ["content-fallback", "localization"]);
  const markup = await runAnnouncement({ adapter: "raw-markup" });
  assert.deepEqual(fps(markup.envelope), ["wma:content-fallback:broken-markup"]);
});

// --- T12.7 gate ---------------------------------------------------------------------------

test("T12.7 gate: sólo señal ausente, schema/N-A inválido o test contractual fallido es elegible a bloqueo", async () => {
  const blocking = [
    { manifest: manifestDoc((d) => d.modules.push({ moduleId: "billing", announcementRequired: true })) },
    { rawManifest: "{}" },
    { manifest: manifestDoc((d) => (d.governedNa[0].reviewBy = "2026-01-01T00:00:00Z")) },
    { adapter: "trap-escape" },
  ];
  for (const opts of blocking) {
    const a = await runAnnouncement({ ...opts, level: "enforce", enforce: true });
    const b = await runAnnouncement({ ...opts, level: "enforce", enforce: true });
    assert.equal(a.envelope.result.decision, "deny", JSON.stringify(rules(a.envelope)));
    assert.equal(a.envelope.blockingEligible, true);
    assert.deepEqual(fps(a.envelope), fps(b.envelope), "reproducible");
    const warn = await runAnnouncement({ ...opts, level: "warn" });
    assert.equal(warn.envelope.result.decision, "warn");
    assert.equal(warn.report.outcome.policyDeny, false);
  }
  const nonBlocking = [
    { noManifest: true },
    { adapter: "throws" },
    { manifest: manifestDoc((d) => delete d.harness) },
  ];
  for (const opts of nonBlocking) {
    const { envelope, report } = await runAnnouncement({ ...opts, level: "enforce", enforce: true });
    assert.notEqual(envelope.result && envelope.result.decision, "deny", JSON.stringify(opts));
    assert.equal(report.outcome.policyDeny, false);
  }
});

test("T12.7 gate: harness reproducible y sin identidades/contenido en traza, reporte ni evidencia", async () => {
  const factory = loadAdapter("good");
  assert.deepEqual(await runSuite(factory, PARAMS), await runSuite(factory, PARAMS));
  const trace = await runSuite(loadAdapter("leaky"), PARAMS);
  assert.deepEqual(sweepArtifacts({ trace: JSON.stringify(trace) }, { canaries: CANARIES }), []);
  assert.ok(!JSON.stringify(trace).includes("Nuevo módulo"), "el texto renderizado no llega a la traza");
  assert.ok(steps(trace, "first-visit")[0].droppedFields > 0);
  const { envelope, report, evidence } = await runAnnouncement({ adapter: "leaky" });
  assert.equal(envelope.result.decision, "allow", "los campos extra sólo se cuentan");
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-wma-ev-")));
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
