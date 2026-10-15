"use strict";

// T13.5: búsqueda local con N/A, módulo no anunciable con N/A y waiver
// temporal por control, cargados desde archivos y evaluados con los
// controles builtin reales.

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
const { loadExceptions } = require("../../../src/engineering/guardrails/exceptions/index.js");
const H = require("../helpers/catalogs.js");
const P = require("../helpers/pipeline.js");

const FIX = path.join(__dirname, "..", "fixtures");
const SEARCH = "search.input-rate";
const VERSION = "app.minimum-supported-version";
const ANNOUNCE = "web.module-announcement";

// Catálogo de prueba 1.3.0: los tres controles admiten enforce (pr/release).
let catalogRoot = null;
function catalogOptions() {
  if (!catalogRoot) {
    catalogRoot = H.tmpDir("kiritek-eng-exc-cat-");
    H.writeCatalog(catalogRoot, H.buildFiles((d) => {
      d.version = "1.3.0";
      for (const ctl of d.controls) {
        ctl.supportedLevels = ["off", "warn", "enforce"];
        const slug = ctl.id.replace(/\./g, "-");
        ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: `test/engineering/contract/${slug}`, approvedVersion: "1.0.0", moments: ["pr", "release"] };
      }
    }));
    process.on("exit", () => fs.rmSync(catalogRoot, { recursive: true, force: true }));
  }
  return { roots: [catalogRoot], approvedConformanceSuites: [SEARCH, VERSION, ANNOUNCE].map((id) => `test/engineering/contract/${id.replace(/\./g, "-")}@1.0.0`) };
}

const versionContract = {
  schemaVersion: 1,
  control: VERSION,
  versionScheme: "semver",
  environments: { production: { source: { kind: "remote-config", authenticity: "signature", keyId: "policy-k1" }, cacheTtlSeconds: 21600, staleIfOfflineSeconds: 86400, timeoutMs: 3000 } },
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

const BASE_FILES = {
  "apps/search/search.adapter.js": fs.readFileSync(path.join(FIX, "search", "good-debounce.adapter.js.fixture")),
  "apps/search/search.contract.json": JSON.stringify({ schemaVersion: 1, control: SEARCH, triggers: "local", cancellation: "supported", equivalence: "trim-lowercase", harness: { kind: "node-adapter", adapter: "apps/search/search.adapter.js" } }),
  "apps/search/docs/local-search.md": "# Medición: 180 elementos en memoria, p95 2 ms\n",
  "apps/admin/docs/internal-only.md": "# Consola interna: sin audiencia externa\n",
  "apps/mobile/good.adapter.js": fs.readFileSync(path.join(FIX, "version", "good.adapter.js.fixture")),
  "apps/mobile/gate.adapter.js": fs.readFileSync(path.join(FIX, "version", "lexicographic.adapter.js.fixture")),
  "apps/mobile/version-policy.json": JSON.stringify(versionContract),
};

const searchNa = (over = {}) => ({
  schemaVersion: 1,
  kind: "governed-na",
  id: "NA-search-local",
  controlId: SEARCH,
  unitId: "acme/search",
  scope: { paths: ["apps/search/**"] },
  functionalReason: "Búsqueda local en memoria sobre catálogo acotado; no hay trabajo remoto que limitar.",
  owner: "team-search",
  evidenceRef: "apps/search/docs/local-search.md",
  createdAt: "2026-10-01T00:00:00Z",
  reviewAt: "2027-03-01T00:00:00Z",
  ...over,
});

const adminNa = (over = {}) => ({
  schemaVersion: 1,
  kind: "governed-na",
  id: "NA-admin-console",
  controlId: ANNOUNCE,
  unitId: "acme/admin",
  scope: { paths: ["apps/admin/**"] },
  functionalReason: "Consola interna de operaciones: sus módulos no se anuncian a usuarios.",
  owner: "team-ops",
  approver: "web-leads",
  criticality: "high",
  evidenceRef: "apps/admin/docs/internal-only.md",
  createdAt: "2026-10-01T00:00:00Z",
  reviewAt: "2027-04-01T00:00:00Z",
  ...over,
});

const versionWaiver = (over = {}) => ({
  schemaVersion: 1,
  kind: "waiver",
  id: "W-mobile-semver",
  controlId: VERSION,
  controlVersion: "1.0.0",
  unitId: "acme/mobile",
  target: { ruleId: `${VERSION}/version-comparison` },
  scope: { paths: ["apps/mobile/**"] },
  owner: "team-mobile",
  reason: "Comparador semver nuevo en revisión; release 4.2 lo incorpora. CONFIDENCIAL-RAZON",
  ticket: "MOB-777",
  approver: "mobile-leads",
  createdAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-11-01T00:00:00Z",
  ...over,
});

/**
 * Repo con tres unidades (acme/search, acme/admin, acme/mobile) en enforce.
 * `exceptions`: { "<archivo>": doc }. `paths`: cambio por unidad.
 */
async function runRepo({ exceptions = {}, paths = {}, now = P.NOW } = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-exc-int-")));
  try {
    for (const [rel, content] of Object.entries({ ...BASE_FILES, ...Object.fromEntries(Object.entries(exceptions).map(([f, d]) => [f, JSON.stringify(d)])) })) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content);
    }
    const unit = (id, root, profiles, controls) => ({ id, root, kind: "application", profiles: profiles.map((p) => ({ id: p, version: "1.0.0" })), owns: [`${root}/**`], controls });
    const document = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog: "1.3.0" },
      workspace: {
        units: [
          unit("acme/search", "apps/search", ["web", "search"], { [SEARCH]: { level: "enforce", parameters: { behaviorContract: "apps/search/search.contract.json" } }, [ANNOUNCE]: { level: "off" } }),
          unit("acme/admin", "apps/admin", ["web", "module-launch"], { [ANNOUNCE]: { level: "enforce" } }),
          unit("acme/mobile", "apps/mobile", ["mobile-app"], { [VERSION]: { level: "enforce", parameters: { policyContract: "apps/mobile/version-policy.json" } } }),
        ],
      },
    };
    const session = createCatalogSession(catalogOptions());
    const resolvedConfig = resolveEngineeringConfig({ document, env: {}, repoRoot: repo, catalogSession: session });
    const catalogSnapshot = session.snapshot;
    const resolvedUnits = resolveUnits(resolvedConfig, catalogSnapshot, { repoRoot: repo });
    const changed = { "acme/search": ["apps/search/search.ts"], "acme/admin": ["apps/admin/src/modules/audit/index.tsx"], "acme/mobile": ["apps/mobile/lib/gate.dart"], ...paths };
    const units = Object.entries(changed).map(([unitId, p]) => {
      const u = { unitId, coverage: "direct", reasons: ["owns"], paths: p };
      return { ...u, scopeHash: scopeHashFor({ moment: "pr", revision: P.HEAD, baseRevision: P.BASE, unit: u }) };
    });
    const scope = { moment: "pr", revision: P.HEAD, baseRevision: P.BASE, units, diagnostics: [] };
    const loaded = loadExceptions({ repoRoot: repo, resolvedConfig, catalogSnapshot, nowIso: now });
    const out = await evaluateRun({ moment: "pr", resolvedConfig, catalogSnapshot, resolvedUnits, scope, controls: builtinControls(), exceptions: loaded, repoRoot: repo, clock: () => now, platformKey: "test-platform" });
    const env = (unitId, controlId) => out.report.results.find((e) => e.unit.id === unitId && e.control.id === controlId);
    return { ...out, loaded, env };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const NA_DIR = ".kiritek/engineering/not-applicable";
const W_DIR = ".kiritek/engineering/waivers";

test("T13.5 sin excepciones: búsqueda local pide N/A (warn), consola sin manifest avisa, semver lexicográfico bloquea", async () => {
  const { env, report } = await runRepo();
  assert.equal(env("acme/search", SEARCH).result.decision, "warn");
  assert.match(env("acme/search", SEARCH).result.reason, /LOCAL_SEARCH_REQUIRES_GOVERNED_NA/);
  assert.equal(env("acme/admin", ANNOUNCE).result.decision, "warn");
  assert.equal(env("acme/mobile", VERSION).result.decision, "deny");
  assert.equal(report.outcome.policyDeny, true);
  assert.deepEqual(report.exceptions.debt, { waivers: 0, suppressedFindings: 0, notApplicable: 0 });
});

test("T13.5 N/A gobernado: búsqueda local y módulo no anunciable quedan not_applicable con deuda visible", async () => {
  const { env, report } = await runRepo({ exceptions: { [`${NA_DIR}/search-local.json`]: searchNa(), [`${NA_DIR}/admin-console.json`]: adminNa() } });
  for (const [unitId, controlId, ref] of [["acme/search", SEARCH, "NA-search-local"], ["acme/admin", ANNOUNCE, "NA-admin-console"]]) {
    const e = env(unitId, controlId);
    assert.equal(e.state, "not_applicable", unitId);
    assert.deepEqual(e.suppressed.map((s) => s.ref), [ref]);
  }
  assert.equal(report.exceptions.debt.notApplicable, 2);
  assert.equal(report.exceptions.nextExpiry, "2027-03-01T00:00:00Z");
  assert.deepEqual(report.events.filter((x) => x.type === "exception-applied").map((x) => x.ref).sort(), ["NA-admin-console", "NA-search-local"]);
});

test("T13.5 N/A inválido (sin prueba, crítico sin aprobador) se rechaza y el control sigue evaluándose", async () => {
  const { env, report } = await runRepo({
    exceptions: {
      [`${NA_DIR}/search-local.json`]: searchNa({ evidenceRef: "apps/search/docs/no-existe.md" }),
      [`${NA_DIR}/admin-console.json`]: adminNa({ approver: undefined }),
    },
  });
  assert.equal(env("acme/search", SEARCH).state, "evaluated");
  assert.equal(env("acme/admin", ANNOUNCE).state, "evaluated");
  assert.deepEqual(report.exceptions.rejected.map((r) => [r.ref, r.errors]), [["NA-admin-console", ["APPROVER_REQUIRED"]], ["NA-search-local", ["NA_EVIDENCE_MISSING"]]]);
  assert.ok(report.diagnostics.some((d) => d.code === "EXCEPTIONS_REJECTED"));
});

test("T13.4 N/A reactivado: cambio fuera de su alcance o revisión vencida", async () => {
  const narrow = searchNa({ scope: { paths: ["apps/search/src/**"] } });
  const moved = await runRepo({ exceptions: { [`${NA_DIR}/s.json`]: narrow }, paths: { "acme/search": ["apps/search/src/box.ts", "apps/search/legacy.ts"] } });
  assert.equal(moved.env("acme/search", SEARCH).state, "evaluated");
  assert.deepEqual(moved.report.exceptions.reactivated.map((r) => r.code), ["GOVERNED_NA_SCOPE_CHANGED"]);
  const late = await runRepo({ exceptions: { [`${NA_DIR}/s.json`]: searchNa() }, now: "2027-03-02T00:00:00.000Z" });
  assert.equal(late.env("acme/search", SEARCH).state, "evaluated");
  assert.deepEqual(late.report.exceptions.reactivated.map((r) => r.code), ["GOVERNED_NA_EXPIRED"]);
  assert.ok(late.report.events.some((x) => x.type === "exception-reactivated" && x.ref === "NA-search-local"));
});

test("T13.5 waiver temporal por control: deny ⇒ warn con deuda; expira o cambia versión ⇒ vuelve a bloquear", async () => {
  const waived = await runRepo({ exceptions: { [`${W_DIR}/mobile-semver.json`]: versionWaiver() } });
  const e = waived.env("acme/mobile", VERSION);
  assert.equal(e.result.decision, "warn");
  assert.match(e.result.reason, /SUPPRESSED_DEBT/);
  assert.ok(e.result.findings.length >= 2 && e.result.findings.every((f) => f.status === "suppressed"));
  assert.equal(e.blockingEligible, false);
  assert.equal(waived.report.outcome.policyDeny, false);
  assert.deepEqual(waived.report.exceptions.applied.map((a) => [a.ref, a.findings]), [["W-mobile-semver", e.result.findings.length]]);
  assert.equal(waived.report.exceptions.nextExpiry, "2026-11-01T00:00:00Z");
  const text = JSON.stringify(waived.report);
  for (const secret of ["CONFIDENCIAL-RAZON", "MOB-777", "team-mobile", "mobile-leads"]) assert.ok(!text.includes(secret), `${secret} no se publica`);

  const expired = await runRepo({ exceptions: { [`${W_DIR}/mobile-semver.json`]: versionWaiver() }, now: "2026-11-02T00:00:00.000Z" });
  assert.equal(expired.env("acme/mobile", VERSION).result.decision, "deny");
  assert.deepEqual(expired.report.exceptions.reactivated.map((r) => r.code), ["WAIVER_EXPIRED"]);

  const bumped = await runRepo({ exceptions: { [`${W_DIR}/mobile-semver.json`]: versionWaiver({ controlVersion: "0.9.0" }) } });
  assert.equal(bumped.env("acme/mobile", VERSION).result.decision, "deny");
  assert.deepEqual(bumped.report.exceptions.reactivated.map((r) => r.code), ["WAIVER_CONTROL_CHANGED"]);
});

test("T13.3 waiver de un solo finding no oculta el resto; waiver global o autoaprobado se rechaza", async () => {
  const one = await runRepo({ exceptions: { [`${W_DIR}/one.json`]: versionWaiver({ target: { fingerprint: "amsv:version-comparison:lexicographic" } }) } });
  const e = one.env("acme/mobile", VERSION);
  assert.equal(e.result.decision, "deny", "quedan findings activos");
  assert.deepEqual(e.result.findings.filter((f) => f.status === "suppressed").map((f) => f.fingerprint), ["amsv:version-comparison:lexicographic"]);
  const abuse = await runRepo({
    exceptions: {
      [`${W_DIR}/global.json`]: versionWaiver({ id: "W-global", scope: { paths: ["**"] } }),
      [`${W_DIR}/self.json`]: versionWaiver({ id: "W-self", approver: "team-mobile" }),
      [`${W_DIR}/long.json`]: versionWaiver({ id: "W-long", expiresAt: "2027-06-01T00:00:00Z" }),
    },
  });
  assert.equal(abuse.env("acme/mobile", VERSION).result.decision, "deny");
  assert.deepEqual(abuse.report.exceptions.rejected.map((r) => [r.ref, r.errors.join(",")]), [["W-global", "GLOBAL_SCOPE"], ["W-long", "EXPIRY_EXCESSIVE"], ["W-self", "SELF_APPROVAL"]]);
});
