"use strict";

// T03: configuración engineering con procedencia por hoja.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveEngineeringConfig, levelFor, provenanceReport } = require("../../../src/engineering/guardrails/config/index.js");
const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const H = require("../helpers/catalogs.js");

const TEMPLATE = path.join(__dirname, "..", "..", "..", "templates", "engineering", "guardrails", "config", "kiritek-engineering.config.json");
const CONFIG = "kiritek-engineering.config.json";
const ORG_SOURCE = "https://policy.example.invalid/engineering.json";

function baseDoc() {
  return {
    schemaVersion: 1,
    pack: { id: "engineering/guardrails", catalog: "1.0.0" },
    workspace: {
      units: [
        {
          id: "acme/search-web",
          root: "apps/search web",
          kind: "application",
          profiles: [{ id: "web", version: "1.0.0" }, { id: "search", version: "1.0.0" }],
          owns: ["apps/search web/**"],
          dependsOn: ["acme/mobile"],
        },
        {
          id: "acme/mobile",
          root: "apps/mobile",
          kind: "application",
          profiles: [{ id: "mobile-app", version: "1.0.0" }],
          owns: ["apps/mobile/**"],
        },
      ],
    },
  };
}

function resolve(doc, extra = {}) {
  return resolveEngineeringConfig({ document: doc, env: {}, ...extra });
}

function org(controls, overrides = {}) {
  return { document: { schemaVersion: 1, controls }, verified: true, source: ORG_SOURCE, keyId: "org-2026", ...overrides };
}

function withOrg(doc, required = false) {
  doc.organization = { source: ORG_SOURCE, trustKeyId: "org-2026", required };
  return doc;
}

/** Repo temporal con unidades y config en disco. */
function withRepo(doc, fn) {
  const dir = H.tmpDir("kiritek-eng-cfg-");
  try {
    for (const u of doc.workspace.units) fs.mkdirSync(path.join(dir, u.root), { recursive: true });
    fs.writeFileSync(path.join(dir, CONFIG), JSON.stringify(doc, null, 2));
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Catálogo de prueba 1.1.0 con search.input-rate capaz de enforce (suite aprobada). */
function withEnforceCatalog(fn) {
  const dir = H.tmpDir();
  try {
    const root = H.writeCatalog(dir, H.buildFiles((doc) => {
      doc.version = "1.1.0";
      const ctl = doc.controls[0];
      ctl.supportedLevels = ["off", "warn", "enforce"];
      ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: "suite/search", approvedVersion: "1.0.0", moments: ["pr"] };
    }));
    return fn({ roots: [root], approvedConformanceSuites: ["suite/search@1.0.0"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const P = (unit, control, leaf = "level") => `/units/${unit.replace(/\//g, "~1")}/controls/${control}/${leaf}`;

// --- T03.1 ---------------------------------------------------------------

test("T03.1 plantilla válida: schema, resolución y todos los controles en warn", () => {
  const doc = JSON.parse(fs.readFileSync(TEMPLATE, "utf8"));
  assert.deepEqual(validateAgainst("engineering/config", doc, { extended: true }).errors, []);
  const r = resolve(doc);
  for (const id of ["search.input-rate", "app.minimum-supported-version", "web.module-announcement"]) {
    assert.equal(levelFor(r, null, id), "warn");
  }
  assert.deepEqual(r.effective.units, []);
  assert.equal(r.effective.telemetry.enabled, false);
});

test("T03.1 soporta niveles, unidades, perfiles, parámetros, budgets, evidencia, excepciones, plugins y telemetría", () => {
  const doc = baseDoc();
  doc.workspace.units[0].controls = { "search.input-rate": { level: "off", parameters: { minChars: 2 } } };
  doc.execution = { budgetsMs: { agent: 1000 }, offline: true, maxProcesses: 2 };
  doc.evidence = { directory: ".kiritek/ev", retentionDays: 7 };
  doc.exceptions = { waiverFiles: ["governance/waivers/*.json"] };
  doc.telemetry = { enabled: true, endpoint: "https://telemetry.example.invalid/v1", retentionDays: 7, categories: ["duration"] };
  doc.plugins = [{ id: "acme/extra", version: "1.0.0", digest: `sha256:${"e".repeat(64)}` }];
  const r = resolve(doc);
  const web = r.effective.units.find((u) => u.unit.id === "acme/search-web");
  assert.equal(web.controls["search.input-rate"].level, "off");
  assert.equal(web.controls["search.input-rate"].parameters.minChars, 2);
  assert.deepEqual(web.unit.profiles.map((p) => [p.id, p.source]), [["web", "explicit"], ["search", "explicit"]]);
  assert.equal(r.effective.execution.budgetsMs.agent, 1000);
  assert.equal(r.effective.execution.budgetsMs.pr, 600000);
  assert.equal(r.effective.execution.offline, true);
  assert.deepEqual(r.effective.exceptions.waiverFiles, ["governance/waivers/*.json"]);
  assert.deepEqual(r.effective.exceptions.notApplicableFiles, [".kiritek/engineering/not-applicable/*.json"]);
  assert.equal(r.effective.plugins.length, 1);
  assert.equal(r.effective.telemetry.categories[0], "duration");
});

test("T03.1 enforce sólo si el catálogo lo soporta; nunca degradación silenciosa", () => {
  const doc = baseDoc();
  doc.defaults = { controls: { "search.input-rate": { level: "enforce" } } };
  assert.throws(() => resolve(doc), (err) => err.code === "CONFIG_LEVEL_UNSUPPORTED" && /warn/.test(err.remediation));
  withEnforceCatalog((catalogOptions) => {
    const d = baseDoc();
    d.pack.catalog = "1.1.0";
    d.defaults = { controls: { "search.input-rate": { level: "enforce" } } };
    const r = resolve(d, { catalogOptions });
    assert.equal(levelFor(r, "acme/search-web", "search.input-rate"), "enforce");
    d.defaults.controls["app.minimum-supported-version"] = { level: "enforce" };
    assert.throws(() => resolve(d, { catalogOptions }), { code: "CONFIG_LEVEL_UNSUPPORTED" });
  });
});

// --- T03.2 / T03.6: precedencia completa --------------------------------

test("T03.2 tabla de precedencia de nivel: catálogo < org < repo < unidad < env < flag", () => {
  const U = "acme/search-web";
  const C = "search.input-rate";
  const steps = [
    { label: "catálogo", apply: () => ({ doc: baseDoc(), opts: {} }), level: "warn", kind: "catalog" },
    { label: "organización", apply: () => ({ doc: withOrg(baseDoc()), opts: { organizationPolicy: org({ [C]: { level: "off" } }) } }), level: "off", kind: "organization" },
    {
      label: "repositorio",
      apply: () => {
        const doc = withOrg(baseDoc());
        doc.defaults = { controls: { [C]: { level: "warn" } } };
        return { doc, opts: { organizationPolicy: org({ [C]: { level: "off" } }) } };
      },
      level: "warn",
      kind: "repo",
    },
    {
      label: "unidad",
      apply: () => {
        const doc = withOrg(baseDoc());
        doc.defaults = { controls: { [C]: { level: "warn" } } };
        doc.workspace.units[0].controls = { [C]: { level: "off" } };
        return { doc, opts: { organizationPolicy: org({ [C]: { level: "off" } }) } };
      },
      level: "off",
      kind: "unit",
    },
    {
      label: "env",
      apply: () => {
        const doc = baseDoc();
        doc.workspace.units[0].controls = { [C]: { level: "off" } };
        return { doc, opts: { env: { KIRITEK_ENGINEERING_LEVELS: `${C}=warn` } } };
      },
      level: "warn",
      kind: "env",
    },
    {
      label: "flag",
      apply: () => {
        const doc = baseDoc();
        doc.workspace.units[0].controls = { [C]: { level: "warn" } };
        return { doc, opts: { env: { KIRITEK_ENGINEERING_LEVELS: `${C}=warn` }, flags: { levels: { [C]: "off" } } } };
      },
      level: "off",
      kind: "flag",
    },
  ];
  for (const step of steps) {
    const { doc, opts } = step.apply();
    const r = resolve(doc, opts);
    assert.equal(levelFor(r, U, C), step.level, step.label);
    assert.equal(r.provenance[P(U, C)].sourceKind, step.kind, `${step.label}: procedencia`);
  }
});

test("T03.2 parámetros se fusionan por hoja con procedencia propia; arrays se reemplazan", () => {
  const doc = withOrg(baseDoc());
  doc.defaults = { controls: { "search.input-rate": { parameters: { dedupeWindowMs: 100 } } } };
  doc.workspace.units[0].controls = { "search.input-rate": { parameters: { cadence: { strategy: "debounce", windowMs: 300 } } } };
  doc.workspace.units[1].controls = { "app.minimum-supported-version": { parameters: { environments: ["staging"] } } };
  const r = resolve(doc, { organizationPolicy: org({ "search.input-rate": { parameters: { minChars: 4, dedupeWindowMs: 50 } } }) });
  const web = r.effective.units.find((u) => u.unit.id === "acme/search-web").controls["search.input-rate"].parameters;
  assert.deepEqual(web, { minChars: 4, cadence: { strategy: "debounce", windowMs: 300 }, dedupeWindowMs: 100, maxEvidenceAgeHours: 24 });
  const kind = (leaf) => r.provenance[P("acme/search-web", "search.input-rate", `parameters/${leaf}`)].sourceKind;
  assert.equal(kind("minChars"), "organization");
  assert.equal(kind("dedupeWindowMs"), "repo");
  assert.equal(kind("cadence/windowMs"), "unit");
  assert.equal(kind("maxEvidenceAgeHours"), "catalog");
  const mobile = r.effective.units.find((u) => u.unit.id === "acme/mobile").controls["app.minimum-supported-version"].parameters;
  assert.deepEqual(mobile.environments, ["staging"], "arrays se reemplazan, no se concatenan");
});

test("T03.6 overrides multiunidad: el override acotado a una unidad no afecta a las demás", () => {
  const doc = baseDoc();
  doc.workspace.units[1].controls = { "search.input-rate": { level: "off" } };
  const r = resolve(doc, { env: { KIRITEK_ENGINEERING_LEVELS: "web.module-announcement@acme/search-web=off,web.module-announcement=warn" } });
  assert.equal(levelFor(r, "acme/search-web", "web.module-announcement"), "off");
  assert.equal(levelFor(r, "acme/mobile", "web.module-announcement"), "warn");
  assert.equal(levelFor(r, "acme/mobile", "search.input-rate"), "off");
  assert.equal(levelFor(r, "acme/search-web", "search.input-rate"), "warn");
  // Flag global (capa superior) gana al env acotado.
  const r2 = resolve(doc, {
    env: { KIRITEK_ENGINEERING_LEVELS: "web.module-announcement@acme/search-web=off" },
    flags: { levels: ["web.module-announcement=warn"] },
  });
  assert.equal(levelFor(r2, "acme/search-web", "web.module-announcement"), "warn");
  assert.throws(() => resolve(doc, { flags: { levels: { "search.input-rate@acme/nope": "off" } } }), { code: "CONFIG_UNKNOWN_UNIT" });
});

test("T03.2 perfiles de unidad no se heredan salvo inheritProfiles", () => {
  const doc = baseDoc();
  doc.workspace.profiles = [{ id: "module-launch", version: "1.0.0" }];
  const r = resolve(doc);
  assert.equal(r.effective.units.find((u) => u.unit.id === "acme/mobile").unit.profiles.some((p) => p.id === "module-launch"), false);
  doc.workspace.inheritProfiles = true;
  doc.workspace.units[1].inheritProfiles = false;
  const r2 = resolve(doc);
  const web = r2.effective.units.find((u) => u.unit.id === "acme/search-web").unit;
  assert.deepEqual(web.profiles.map((p) => `${p.id}:${p.source}`), ["web:explicit", "search:explicit", "module-launch:inherited"]);
  assert.equal(r2.effective.units.find((u) => u.unit.id === "acme/mobile").unit.profiles.length, 1);
  assert.equal(r2.provenance["/units/acme~1search-web/profiles/module-launch@1.0.0"].sourceKind, "inherited");
});

test("T03.2 catálogo: flag > env > repo; digest fijado aplica sólo a la versión fijada", () => {
  const doc = baseDoc();
  assert.throws(() => resolve(doc, { flags: { catalog: "2.0.0" } }), { code: "CATALOG_NOT_INSTALLED" });
  assert.throws(() => resolve(doc, { env: { KIRITEK_ENGINEERING_CATALOG: "latest" } }), { code: "CONFIG_INVALID_OVERRIDE" });
  doc.pack.catalogDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => resolve(doc), { code: "CATALOG_DIGEST_PINNED_MISMATCH" });
  const r = resolve(baseDoc(), { env: { KIRITEK_ENGINEERING_CATALOG: "1.0.0" } });
  assert.equal(r.provenance["/pack/catalog"].sourceKind, "env");
});

// --- T03.3: procedencia, locks y conflictos ------------------------------

test("T03.3 nivel organizacional locked no puede rebajarse desde capas superiores", () => {
  const policy = org({ "web.module-announcement": { level: "warn", locked: true } });
  const doc = withOrg(baseDoc());
  doc.workspace.units[0].controls = { "web.module-announcement": { level: "off" } };
  assert.throws(() => resolve(doc, { organizationPolicy: policy }), { code: "CONFIG_CONFLICT" });
  assert.throws(() => resolve(withOrg(baseDoc()), { organizationPolicy: policy, flags: { levels: { "web.module-announcement": "off" } } }), { code: "CONFIG_CONFLICT" });
  // Mismo valor: permitido, la procedencia sigue siendo la organización.
  const same = withOrg(baseDoc());
  same.defaults = { controls: { "web.module-announcement": { level: "warn" } } };
  const r = resolve(same, { organizationPolicy: policy });
  assert.equal(r.provenance[P("acme/mobile", "web.module-announcement")].sourceKind, "organization");
});

test("T03.3 parámetros organizacionales locked también se protegen", () => {
  const policy = org({ "search.input-rate": { parameters: { minChars: 3, cadence: { strategy: "debounce", windowMs: 200 } }, locked: true } });
  const doc = withOrg(baseDoc());
  doc.workspace.units[0].controls = { "search.input-rate": { parameters: { cadence: { strategy: "debounce", windowMs: 999 } } } };
  assert.throws(() => resolve(doc, { organizationPolicy: policy }), { code: "CONFIG_CONFLICT" });
  const free = withOrg(baseDoc());
  free.workspace.units[0].controls = { "search.input-rate": { parameters: { dedupeWindowMs: 10 } } };
  assert.equal(resolve(free, { organizationPolicy: policy }).effective.units[1].controls["search.input-rate"].parameters.dedupeWindowMs, 10);
});

test("T03.3 política organizacional sólo participa si está verificada", () => {
  const policy = org({ "search.input-rate": { level: "off" } });
  const unverified = resolve(withOrg(baseDoc()), { organizationPolicy: { ...policy, verified: false } });
  assert.equal(levelFor(unverified, "acme/search-web", "search.input-rate"), "warn");
  assert.equal(unverified.effective.organization.participating, false);
  assert.ok(unverified.diagnostics.some((d) => d.code === "ORG_POLICY_UNVERIFIED"));

  const otherSource = resolve(withOrg(baseDoc()), { organizationPolicy: { ...policy, source: "https://evil.example.invalid/p.json" } });
  assert.equal(levelFor(otherSource, "acme/search-web", "search.input-rate"), "warn");

  const noDecl = resolve(baseDoc(), { organizationPolicy: policy });
  assert.equal(levelFor(noDecl, "acme/search-web", "search.input-rate"), "warn");

  assert.throws(() => resolve(withOrg(baseDoc(), true), {}), { code: "CONFIG_ORG_UNVERIFIED" });
  assert.throws(() => resolve(withOrg(baseDoc()), { organizationPolicy: org({ "nope.control": { level: "off" } }) }), { code: "CONFIG_UNKNOWN_CONTROL" });
});

test("T03.3 ambigüedades y referencias inválidas fallan explícitamente", () => {
  const dupUnit = baseDoc();
  dupUnit.workspace.units[1].id = "acme/search-web";
  dupUnit.workspace.units[0].dependsOn = [];
  assert.throws(() => resolve(dupUnit), { code: "CONFIG_DUPLICATE_UNIT" });

  const badDep = baseDoc();
  badDep.workspace.units[0].dependsOn = ["acme/ghost"];
  assert.throws(() => resolve(badDep), { code: "CONFIG_UNKNOWN_UNIT" });

  const alias = baseDoc();
  alias.workspace.units[0].identityAliases = ["acme/mobile"];
  assert.throws(() => resolve(alias), { code: "CONFIG_AMBIGUOUS" });

  const twoVersions = baseDoc();
  twoVersions.workspace.units[0].profiles.push({ id: "web", version: "2.0.0" });
  assert.throws(() => resolve(twoVersions), (err) => ["CONFIG_PROFILE_VERSION", "CONFIG_AMBIGUOUS"].includes(err.code));

  const unknownProfile = baseDoc();
  unknownProfile.workspace.units[0].profiles.push({ id: "acme/checkout", version: "1.0.0" });
  assert.throws(() => resolve(unknownProfile), { code: "CONFIG_UNKNOWN_PROFILE" });
});

// --- T03.4: aislamiento respecto del modo security -----------------------

test("T03.4 el modo de security no eleva ni reduce niveles engineering", () => {
  const doc = baseDoc();
  withRepo(doc, (dir) => {
    const baseline = resolveEngineeringConfig({ repoRoot: dir, env: {} });
    fs.writeFileSync(path.join(dir, "kiritek-security.config.json"), JSON.stringify({ schemaVersion: 1, mode: "enforce" }));
    for (const env of [{ KIRITEK_MODE: "enforce" }, { KIRITEK_MODE: "warning", KIRITEK_SECURITY: "off" }]) {
      const r = resolveEngineeringConfig({ repoRoot: dir, env });
      assert.deepEqual(r.effective, baseline.effective);
      assert.equal(r.configHash, baseline.configHash);
    }
  });
  const withMode = baseDoc();
  withMode.mode = "enforce";
  assert.throws(() => resolve(withMode), { code: "CONFIG_SCHEMA" });
  assert.throws(() => resolve(baseDoc(), { flags: { mode: "enforce" } }), { code: "CONFIG_FLAG_NOT_ALLOWED" });
  assert.throws(() => resolve(baseDoc(), { flags: { security: "off" } }), { code: "CONFIG_FLAG_NOT_ALLOWED" });
});

// --- T03.5: rechazos ------------------------------------------------------

test("T03.5 credenciales rechazadas en config, flags y env sin repetir el valor", () => {
  const secret = "ghp_" + "A".repeat(36);
  const inParam = baseDoc();
  inParam.workspace.units[0].controls = { "search.input-rate": { parameters: { behaviorContract: `tests/${secret}.json` } } };
  assert.throws(() => resolve(inParam), (err) => err.code === "CONFIG_SECRET_REJECTED" && !err.message.includes(secret));

  const keyName = baseDoc();
  keyName.workspace.units[0].profiles[0].parameters = { apiToken: "x" };
  assert.throws(() => resolve(keyName), { code: "CONFIG_SECRET_REJECTED" });

  const credUrl = baseDoc();
  credUrl.telemetry = { enabled: true, endpoint: "https://user:pass@telemetry.example.invalid/v1" };
  assert.throws(() => resolve(credUrl), (err) => ["CONFIG_SCHEMA", "CONFIG_SECRET_REJECTED"].includes(err.code) && !err.message.includes("pass@"));

  assert.throws(() => resolve(baseDoc(), { flags: { token: "abc" } }), { code: "CONFIG_SECRET_REJECTED" });
  assert.throws(() => resolve(baseDoc(), { flags: { levels: [`search.input-rate=${secret}`] } }), (err) => !err.message.includes(secret));
  assert.throws(() => resolve(baseDoc(), { env: { KIRITEK_ENGINEERING_API_TOKEN: "x" } }), { code: "CONFIG_SECRET_REJECTED" });
  assert.throws(() => resolve(baseDoc(), { env: { KIRITEK_ENGINEERING_CATALOG: `https://u:p@h/${secret}` } }), { code: "CONFIG_SECRET_REJECTED" });
  assert.throws(() => resolve(baseDoc(), { env: { KIRITEK_ENGINEERING_UNKNOWN: "1" } }), { code: "CONFIG_ENV_NOT_ALLOWED" });
});

test("T03.5 campos desconocidos, controles/parámetros desconocidos y tipos inválidos con puntero y remediación", () => {
  const unknownField = baseDoc();
  unknownField.workspace.units[0].surprise = true;
  assert.throws(() => resolve(unknownField), (err) => err.code === "CONFIG_SCHEMA" && err.pointer.includes("/workspace/units/0") && !!err.remediation);

  const unknownControl = baseDoc();
  unknownControl.defaults = { controls: { "search.input-rat": { level: "warn" } } };
  assert.throws(
    () => resolve(unknownControl),
    (err) => err.code === "CONFIG_UNKNOWN_CONTROL" && err.pointer.endsWith("/defaults/controls/search.input-rat") && /search.input-rate/.test(err.remediation)
  );

  const unknownParam = baseDoc();
  unknownParam.workspace.units[0].controls = { "search.input-rate": { parameters: { debounce: 100 } } };
  assert.throws(() => resolve(unknownParam), (err) => err.code === "CONFIG_UNKNOWN_PARAMETER" && /minChars/.test(err.remediation));

  const badType = baseDoc();
  badType.workspace.units[0].controls = { "search.input-rate": { parameters: { minChars: "tres" } } };
  assert.throws(() => resolve(badType), { code: "CONFIG_PARAMETERS_INVALID" });

  const badLevel = baseDoc();
  badLevel.defaults = { controls: { "search.input-rate": { level: "block" } } };
  assert.throws(() => resolve(badLevel), { code: "CONFIG_SCHEMA" });

  const latest = baseDoc();
  latest.pack.catalog = "latest";
  assert.throws(() => resolve(latest), { code: "CONFIG_SCHEMA" });

  const budget = baseDoc();
  budget.execution = { budgetsMs: { agent: 10000 } };
  assert.throws(() => resolve(budget), { code: "CONFIG_SCHEMA" });
});

test("T03.5 roots fuera del repo: absolutos, con '..' o vía symlink", () => {
  const abs = baseDoc();
  abs.workspace.units[0].root = "/etc";
  assert.throws(() => resolve(abs), { code: "CONFIG_SCHEMA" });
  const dots = baseDoc();
  dots.workspace.units[0].owns = ["../other/**"];
  assert.throws(() => resolve(dots), { code: "CONFIG_SCHEMA" });

  const doc = baseDoc();
  withRepo(doc, (dir) => {
    const outside = H.tmpDir("kiritek-eng-outside-");
    try {
      fs.rmSync(path.join(dir, "apps", "mobile"), { recursive: true });
      fs.symlinkSync(outside, path.join(dir, "apps", "mobile"));
      assert.throws(() => resolveEngineeringConfig({ repoRoot: dir, env: {} }), { code: "CONFIG_PATH_OUTSIDE_REPO" });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("T03.5 config ausente o JSON inválido no cae a defaults ocultos", () => {
  const dir = H.tmpDir("kiritek-eng-cfg-");
  try {
    assert.throws(() => resolveEngineeringConfig({ repoRoot: dir, env: {} }), { code: "CONFIG_NOT_FOUND" });
    fs.writeFileSync(path.join(dir, CONFIG), '{\n  "schemaVersion": 1,\n  "pack": {,\n}');
    assert.throws(() => resolveEngineeringConfig({ repoRoot: dir, env: {} }), (err) => err.code === "CONFIG_PARSE" && /línea/.test(err.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- T03.6 gate ----------------------------------------------------------

test("T03.6 gate: origen efectivo redactado y filtrable por unidad", () => {
  const doc = withOrg(baseDoc());
  doc.organization.source = "https://policy.example.invalid/engineering.json";
  doc.telemetry = { enabled: true, endpoint: "https://telemetry.example.invalid/v1/ingest" };
  const r = resolve(doc, { organizationPolicy: org({ "search.input-rate": { level: "off" } }) });
  const rows = provenanceReport(r.provenance, { unitId: "acme/mobile" });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.pointer.startsWith("/units/acme~1mobile/")));
  const orgRow = rows.find((row) => row.pointer.endsWith("/search.input-rate/level"));
  assert.equal(orgRow.sourceKind, "organization");
  assert.equal(orgRow.sourceVersion, "org-2026");
  const all = JSON.stringify(provenanceReport(r.provenance));
  assert.equal(/\/Users\/|\/home\/|[A-Z]:\\/.test(all), false, "sin rutas absolutas");
  assert.equal(r.effective.organization.source, "https://policy.example.invalid/engineering.json");
});

test("T03.6 gate: resolución reproducible e independiente del orden de claves y del host", () => {
  const doc = baseDoc();
  doc.defaults = { controls: { "web.module-announcement": { level: "off" }, "search.input-rate": { parameters: { minChars: 5 } } } };
  const a = resolve(doc, { cpuCount: 2 });
  const shuffled = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(doc))).reverse());
  shuffled.defaults = { controls: { "search.input-rate": { parameters: { minChars: 5 } }, "web.module-announcement": { level: "off" } } };
  const b = resolve(shuffled, { cpuCount: 16 });
  assert.equal(a.configHash, b.configHash);
  assert.deepEqual(a.effective.units, b.effective.units);
  assert.notEqual(a.effective.execution.maxProcesses, b.effective.execution.maxProcesses);
  const c = resolve({ ...doc, defaults: { controls: { "web.module-announcement": { level: "warn" } } } });
  assert.notEqual(c.configHash, a.configHash, "un cambio de nivel cambia el hash");
  assert.ok(Object.isFrozen(a.effective.units[0].controls));
});

test("T03.6 gate: cada hoja de control efectiva tiene procedencia", () => {
  const r = resolve(baseDoc());
  for (const entry of r.effective.units) {
    for (const [id, ctl] of Object.entries(entry.controls)) {
      const base = `/units/${entry.unit.id.replace(/\//g, "~1")}/controls/${id}`;
      assert.ok(r.provenance[`${base}/level`], `${base}/level`);
      const leaves = (obj, prefix) =>
        Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? leaves(v, `${prefix}/${k}`) : [`${prefix}/${k}`]));
      for (const leaf of leaves(ctl.parameters, `${base}/parameters`)) assert.ok(r.provenance[leaf], leaf);
    }
  }
});
