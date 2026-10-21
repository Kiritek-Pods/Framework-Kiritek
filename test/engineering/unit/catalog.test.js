"use strict";

// T02: catálogo versionado, fijado y verificable.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const semver = require("../../../src/engineering/guardrails/catalog/semver.js");
const { resolveCatalog, createCatalogSession } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { loadCatalogFromFiles } = require("../../../src/engineering/guardrails/catalog/load.js");
const { writeToCache, readFromCache, fetchIntoCache } = require("../../../src/engineering/guardrails/catalog/cache.js");
const { runCatalogConformance } = require("../../../src/engineering/guardrails/catalog/conformance.js");
const { diffCatalogs } = require("../../../src/engineering/guardrails/catalog/diff.js");
const { planMigrationPath, migrateControlIds } = require("../../../src/engineering/guardrails/catalog/migrate.js");
const { hashJson } = require("../../../src/engineering/guardrails/canonical.js");
const { createCatalog } = require("../../../src/engineering/guardrails/contracts/catalog.js");
const H = require("../helpers/catalogs.js");

const EMPTY_ROOTS = (dir) => [path.join(dir, "builtin-vacío")];

function withTmp(fn) {
  const dir = H.tmpDir();
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTmpAsync(fn) {
  const dir = H.tmpDir();
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function enforceControl(doc) {
  const ctl = doc.controls[0];
  ctl.supportedLevels = ["off", "warn", "enforce"];
  ctl.enforcementContract = {
    evidenceTypes: ["deterministic"],
    conformanceSuite: "test/engineering/contract/search-input-rate",
    approvedVersion: "1.0.0",
    moments: ["pr"],
  };
}

// --- semver --------------------------------------------------------------

test("semver: precedencia SemVer 2.0.0 incluida prerelease; build metadata ignorada", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
  for (let i = 0; i < ordered.length - 1; i += 1) assert.ok(semver.compare(ordered[i], ordered[i + 1]) < 0, `${ordered[i]} < ${ordered[i + 1]}`);
  assert.equal(semver.compare("1.0.0+a", "1.0.0+b"), 0);
  assert.equal(semver.isExact("latest"), false);
  assert.equal(semver.isExact("^1.0.0"), false);
  assert.equal(semver.isExact("1.0"), false);
});

test("semver: satisfies para rangos de compatibilidad", () => {
  const cases = [
    ["20.12.2", ">=18", true],
    ["16.20.0", ">=18", false],
    ["0.1.0", ">=0.1.0", true],
    ["1.4.2", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["0.2.5", "^0.2.1", true],
    ["0.3.0", "^0.2.1", false],
    ["1.2.9", "~1.2.0", true],
    ["1.3.0", "~1.2.0", false],
    ["18.5.0", ">=18 <20 || >=22", true],
    ["20.1.0", ">=18 <20 || >=22", false],
    ["2.0.0-rc.1", ">=1.0.0", false],
    ["v20.0.0", ">=18", true],
  ];
  for (const [v, r, want] of cases) assert.equal(semver.satisfies(v, r), want, `${v} ⊨ ${r}`);
});

// --- T02.1: catálogo inicial publicado -----------------------------------

test("T02.1 catálogo 1.0.0 builtin: digest válido, perfiles builtin y controles warning-only", () => {
  const snap = resolveCatalog({ version: "1.0.0" });
  assert.equal(snap.ref.id, "engineering/guardrails");
  assert.match(snap.ref.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(snap.source, "builtin");
  assert.deepEqual(snap.catalog.profiles.map((p) => p.id), ["web", "mobile-app", "search", "module-launch"]);
  assert.deepEqual(snap.catalog.controls.map((c) => c.id), ["search.input-rate", "app.minimum-supported-version", "web.module-announcement"]);
  for (const ctl of snap.catalog.controls) {
    assert.deepEqual(ctl.supportedLevels, ["off", "warn"], `${ctl.id} no habilita enforce antes de R27`);
    assert.equal(ctl.enforcementContract, undefined);
    assert.equal(ctl.defaults.level, "warn");
    assert.ok(snap.parameterSchemas[ctl.id], `${ctl.id} con schema de parámetros`);
    assert.ok(ctl.moments.length > 0 && ctl.collectors.length > 0);
  }
  assert.equal(snap.conformance.passed, true);
  assert.ok(Object.keys(snap.files).includes("notes/CHANGELOG.md"), "el digest cubre notas y schemas");
});

test("T02.1 controles declaran perfiles, momentos y parámetros según la matriz de aplicabilidad", () => {
  const { catalog } = resolveCatalog({ version: "1.0.0" });
  const byId = Object.fromEntries(catalog.controls.map((c) => [c.id, c]));
  assert.deepEqual(byId["search.input-rate"].profiles, { allOf: ["search"] });
  assert.deepEqual(byId["app.minimum-supported-version"].profiles, { allOf: ["mobile-app"] });
  assert.deepEqual(byId["web.module-announcement"].profiles, { allOf: ["web", "module-launch"] });
  for (const ctl of catalog.controls) {
    for (const m of ctl.moments) assert.notEqual(m.fallback, "deny");
  }
});

// --- T02.2: snapshot única, sin latest ni fallback ----------------------

test("T02.2 versión exacta obligatoria: latest/rangos/vacío fallan", () => {
  for (const version of ["latest", "^1.0.0", "1.0", "", undefined, "1.x"]) {
    assert.throws(() => resolveCatalog({ version }), (err) => ["CATALOG_VERSION_NOT_EXACT", "CATALOG_VERSION_REQUIRED"].includes(err.code), String(version));
  }
});

test("T02.2 versión no instalada falla sin fallback a otra versión", () => {
  assert.throws(() => resolveCatalog({ version: "9.9.9" }), { code: "CATALOG_NOT_INSTALLED" });
  assert.throws(() => resolveCatalog({ version: "1.0.1" }), { code: "CATALOG_NOT_INSTALLED" });
  assert.throws(() => resolveCatalog({ version: "9.9.9", offline: true }), (err) => /offline/i.test(err.remediation));
});

test("T02.2 sesión fija una snapshot: misma instancia y sin mezcla de versiones", () => {
  const session = createCatalogSession();
  const a = session.resolve("1.0.0");
  const b = session.resolve("1.0.0");
  assert.equal(a, b);
  assert.throws(() => session.resolve("1.1.0"), { code: "CATALOG_MIXED_VERSIONS" });
  assert.throws(() => session.resolve("1.0.0", { expectedDigest: `sha256:${"0".repeat(64)}` }), { code: "CATALOG_MIXED_VERSIONS" });
});

test("T02.2 la snapshot es inmutable y no cambia si el disco cambia después", () => {
  withTmp((dir) => {
    const root = H.writeCatalog(path.join(dir, "builtin"), H.builtinFiles());
    const snap = resolveCatalog({ version: "1.0.0", roots: [root] });
    assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.catalog.controls[0]));
    assert.throws(() => {
      "use strict";
      snap.catalog.controls[0].defaults.level = "enforce";
    }, TypeError);
    fs.writeFileSync(path.join(root, "1.0.0", "notes", "CHANGELOG.md"), "alterado");
    assert.equal(snap.conformance.passed, true);
    assert.throws(() => resolveCatalog({ version: "1.0.0", roots: [root] }), { code: "CATALOG_DIGEST_MISMATCH" });
  });
});

test("T02.2 digest fijado distinto falla", () => {
  assert.throws(() => resolveCatalog({ version: "1.0.0", expectedDigest: `sha256:${"0".repeat(64)}` }), { code: "CATALOG_DIGEST_PINNED_MISMATCH" });
  const ok = resolveCatalog({ version: "1.0.0" });
  assert.equal(resolveCatalog({ version: "1.0.0", expectedDigest: ok.ref.digest }).ref.digest, ok.ref.digest);
});

test("T02.2 incompatibilidad de Node/kiritek-init/plataforma falla antes de evaluar", () => {
  assert.throws(() => resolveCatalog({ version: "1.0.0", runtime: { nodeVersion: "16.20.0" } }), { code: "CATALOG_INCOMPATIBLE" });
  assert.throws(() => resolveCatalog({ version: "1.0.0", runtime: { kiritekInitVersion: "0.0.9" } }), { code: "CATALOG_INCOMPATIBLE" });
  assert.throws(() => resolveCatalog({ version: "1.0.0", runtime: { platform: "aix" } }), { code: "CATALOG_INCOMPATIBLE" });
});

// --- T02.3: digest, firma, cache, offline, diff, deprecación, migración ---

test("T02.3 alterar cualquier archivo del catálogo rompe el digest", () => {
  const files = H.builtinFiles();
  const tamperedSchema = { ...files, "parameters/search.input-rate.schema.json": Buffer.from("{}") };
  assert.throws(() => loadCatalogFromFiles(tamperedSchema), { code: "CATALOG_DIGEST_MISMATCH" });
  const doc = H.docOf(files);
  doc.controls[0].defaults.parameters.minChars = 1;
  assert.throws(() => loadCatalogFromFiles({ ...files, "catalog.json": Buffer.from(JSON.stringify(doc)) }), { code: "CATALOG_DIGEST_MISMATCH" });
  const extra = { ...files, "notes/otro.md": Buffer.from("x") };
  assert.throws(() => loadCatalogFromFiles(extra), { code: "CATALOG_DIGEST_MISMATCH" });
});

test("T02.3 defaults que no cumplen el schema de parámetros se rechazan", () => {
  const files = H.buildFiles((doc) => {
    doc.controls[0].defaults.parameters.minChars = 0;
  });
  assert.throws(() => loadCatalogFromFiles(files), { code: "CATALOG_DEFAULTS_INVALID" });
});

test("T02.3 firma opcional ed25519: verificada, inválida, clave no confiable, requerida", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" });
  const sign = (digest) => Buffer.from(crypto.sign(null, Buffer.from(digest, "utf8"), privateKey).toString("base64"));
  const signed = H.buildFiles(
    (doc) => {
      doc.signature = { keyId: "kiritek-2026", algorithm: "ed25519", signatureRef: "catalog.sig" };
    },
    { sign }
  );
  assert.equal(loadCatalogFromFiles(signed, { trustedKeys: { "kiritek-2026": pem } }).signature, "verified");
  assert.equal(loadCatalogFromFiles(signed).signature, "untrusted-key");
  assert.throws(() => loadCatalogFromFiles(signed, { requireSignature: true }), { code: "CATALOG_SIGNATURE_UNTRUSTED" });

  const forged = { ...signed, "catalog.sig": Buffer.from(crypto.randomBytes(64).toString("base64")) };
  assert.throws(() => loadCatalogFromFiles(forged, { trustedKeys: { "kiritek-2026": pem } }), { code: "CATALOG_SIGNATURE_INVALID" });

  assert.equal(loadCatalogFromFiles(H.builtinFiles()).signature, "absent");
  assert.throws(() => loadCatalogFromFiles(H.builtinFiles(), { requireSignature: true }), { code: "CATALOG_SIGNATURE_REQUIRED" });
});

test("T02.3 cache segura: escritura atómica, idempotente, inmutable y re-verificada", () => {
  withTmp((dir) => {
    const cacheRoot = path.join(dir, "cache");
    assert.equal(writeToCache(cacheRoot, H.builtinFiles()).status, "written");
    assert.equal(writeToCache(cacheRoot, H.builtinFiles()).status, "present");
    assert.deepEqual(fs.readdirSync(cacheRoot).filter((n) => n.startsWith(".tmp-")), []);

    const snap = resolveCatalog({ version: "1.0.0", roots: EMPTY_ROOTS(dir), cacheRoot });
    assert.equal(snap.source, "cache");
    assert.equal(snap.ref.digest, resolveCatalog({ version: "1.0.0" }).ref.digest);

    const other = H.buildFiles((doc) => {
      doc.publishedAt = "2026-10-06T00:00:00Z";
    });
    assert.throws(() => writeToCache(cacheRoot, other), { code: "CATALOG_CACHE_CONFLICT" });
  });
});

test("T02.3 cache corrupta se pone en cuarentena y no se usa", () => {
  withTmp((dir) => {
    const cacheRoot = path.join(dir, "cache");
    writeToCache(cacheRoot, H.builtinFiles());
    fs.writeFileSync(path.join(cacheRoot, "1.0.0", "parameters", "search.input-rate.schema.json"), "{}");
    const diags = [];
    assert.equal(readFromCache(cacheRoot, "1.0.0", { onDiagnostic: (d) => diags.push(d) }), null);
    assert.equal(diags[0].code, "CATALOG_CACHE_CORRUPT");
    assert.equal(fs.existsSync(path.join(cacheRoot, "1.0.0")), false);
    assert.ok(fs.readdirSync(cacheRoot).some((n) => n.startsWith(".corrupt-1.0.0")));
    assert.throws(() => resolveCatalog({ version: "1.0.0", roots: EMPTY_ROOTS(dir), cacheRoot }), { code: "CATALOG_NOT_INSTALLED" });
  });
});

test("T02.3 builtin y cache con distinto digest para la misma versión es conflicto", () => {
  withTmp((dir) => {
    const cacheRoot = path.join(dir, "cache");
    const altered = H.buildFiles((doc) => {
      doc.publishedAt = "2026-10-06T00:00:00Z";
    });
    writeToCache(cacheRoot, altered);
    assert.throws(() => resolveCatalog({ version: "1.0.0", cacheRoot }), { code: "CATALOG_CONFLICT" });
  });
});

test("T02.3 offline nunca invoca al fetcher; online verifica antes de cachear", async () => {
  await withTmpAsync(async (dir) => {
    const cacheRoot = path.join(dir, "cache");
    let calls = 0;
    const fetchCatalog = async () => {
      calls += 1;
      return H.builtinFiles();
    };
    await assert.rejects(fetchIntoCache({ version: "1.0.0", cacheRoot, offline: true, fetchCatalog }), { code: "CATALOG_OFFLINE" });
    assert.equal(calls, 0);

    const tampered = async () => ({ ...H.builtinFiles(), "notes/CHANGELOG.md": Buffer.from("x") });
    await assert.rejects(fetchIntoCache({ version: "1.0.0", cacheRoot, fetchCatalog: tampered }), { code: "CATALOG_DIGEST_MISMATCH" });
    assert.equal(fs.existsSync(path.join(cacheRoot, "1.0.0")), false);

    await assert.rejects(
      fetchIntoCache({ version: "1.0.0", cacheRoot, fetchCatalog, expectedDigest: `sha256:${"0".repeat(64)}` }),
      { code: "CATALOG_DIGEST_PINNED_MISMATCH" }
    );
    assert.equal((await fetchIntoCache({ version: "1.0.0", cacheRoot, fetchCatalog })).status, "written");
    await assert.rejects(fetchIntoCache({ version: "1.0.1", cacheRoot, fetchCatalog }), { code: "CATALOG_VERSION_MISMATCH" });
  });
});

test("T02.3 cache rechaza archivos con rutas que escapan", () => {
  withTmp((dir) => {
    const files = { ...H.builtinFiles(), "../evil.txt": Buffer.from("x") };
    assert.throws(() => writeToCache(path.join(dir, "cache"), files));
    assert.equal(fs.existsSync(path.join(dir, "evil.txt")), false);
  });
});

test("T02.3 diff: control añadido en minor es válido y se reporta", () => {
  const from = createCatalog(H.builtinDoc());
  const to = createCatalog(
    H.docOf(
      H.buildFiles((doc) => {
        doc.version = "1.1.0";
        const ctl = JSON.parse(JSON.stringify(doc.controls[0]));
        ctl.id = "search.result-order";
        doc.controls.push(ctl);
      })
    )
  );
  const d = diffCatalogs(from, to);
  assert.deepEqual(d.controls.added, ["search.result-order"]);
  assert.equal(d.requiredBump, "minor");
  assert.equal(d.actualBump, "minor");
  assert.deepEqual(d.semverViolations, []);
});

test("T02.3 diff: cambio de default de nivel en patch viola semver y se lista como cambio de nivel", () => {
  const from = createCatalog(H.builtinDoc());
  const to = createCatalog(
    H.docOf(
      H.buildFiles((doc) => {
        doc.version = "1.0.1";
        doc.controls[1].defaults.level = "off";
      })
    )
  );
  const d = diffCatalogs(from, to);
  assert.deepEqual(d.levelChanges, [{ controlId: "app.minimum-supported-version", field: "defaults.level", from: "warn", to: "off" }]);
  assert.equal(d.requiredBump, "minor");
  assert.equal(d.semverViolations.length, 1);
});

test("T02.3 diff: habilitar enforce o retirar control exige major con migración", () => {
  const from = createCatalog(H.builtinDoc());
  const minorEnforce = createCatalog(
    H.docOf(
      H.buildFiles((doc) => {
        doc.version = "1.1.0";
        enforceControl(doc);
      })
    )
  );
  const d1 = diffCatalogs(from, minorEnforce);
  assert.equal(d1.requiredBump, "major");
  assert.ok(d1.semverViolations.length > 0);

  const majorNoMigration = createCatalog(
    H.docOf(
      H.buildFiles((doc) => {
        doc.version = "2.0.0";
        doc.controls.pop();
      })
    )
  );
  const d2 = diffCatalogs(from, majorNoMigration);
  assert.deepEqual(d2.controls.removed, ["web.module-announcement"]);
  assert.deepEqual(d2.semverViolations, []);
  assert.match(d2.migrationError, /no hay cadena de migración/);

  const majorWithMigration = createCatalog(
    H.docOf(
      H.buildFiles((doc, files) => {
        doc.version = "2.0.0";
        doc.controls.pop();
        doc.migrations = [{ from: "1.0.0", to: "2.0.0", ref: "notes/migration-1-to-2.md" }];
        files["notes/migration-1-to-2.md"] = Buffer.from("# Migración\n");
      })
    )
  );
  const d3 = diffCatalogs(from, majorWithMigration);
  assert.deepEqual(d3.migrations, [{ from: "1.0.0", to: "2.0.0", ref: "notes/migration-1-to-2.md" }]);
  assert.equal(d3.migrationError, null);
});

test("T02.3 deprecación con reemplazo: diff reporta rename y migrateControlIds propone el cambio", () => {
  const from = createCatalog(H.builtinDoc());
  const toDoc = H.docOf(
    H.buildFiles((doc) => {
      doc.version = "1.1.0";
      const repl = JSON.parse(JSON.stringify(doc.controls[0]));
      repl.id = "search.input-cadence";
      doc.controls.push(repl);
      doc.controls[0].deprecation = { since: "1.1.0", reason: "Renombrado para claridad", replacement: "search.input-cadence" };
    })
  );
  const to = createCatalog(toDoc);
  const d = diffCatalogs(from, to);
  assert.deepEqual(d.controls.renamed, [{ from: "search.input-rate", to: "search.input-cadence" }]);
  assert.equal(d.deprecations[0].id, "search.input-rate");

  const config = { defaults: { controls: { "search.input-rate": { level: "warn" } } }, workspace: { units: [{ controls: { "search.input-rate": { level: "off" } } }] } };
  const m = migrateControlIds(config, to);
  assert.deepEqual(m.config.defaults.controls, { "search.input-cadence": { level: "warn" } });
  assert.deepEqual(m.config.workspace.units[0].controls, { "search.input-cadence": { level: "off" } });
  assert.equal(m.changes.length, 2);
  assert.ok(config.defaults.controls["search.input-rate"], "no muta la entrada");
  assert.equal(runCatalogConformance({ catalog: to, parameterSchemas: { "search.input-rate": {}, "search.input-cadence": {}, "app.minimum-supported-version": {}, "web.module-announcement": {} } }).passed, true);
});

test("T02.3 planMigrationPath encadena migraciones y falla en major sin cadena", () => {
  const to = {
    version: "3.0.0",
    migrations: [
      { from: "1.0.0", to: "2.0.0", ref: "a" },
      { from: "2.0.0", to: "3.0.0", ref: "b" },
    ],
  };
  assert.deepEqual(planMigrationPath("1.0.0", to).map((s) => s.to), ["2.0.0", "3.0.0"]);
  assert.throws(() => planMigrationPath("0.9.0", to), { code: "CATALOG_MIGRATION_MISSING" });
  assert.deepEqual(planMigrationPath("3.0.0", to), []);
});

// --- T02.4: conformidad --------------------------------------------------

test("T02.4 control con enforce sin suite aprobada se rechaza al resolver", () => {
  withTmp((dir) => {
    const root = H.writeCatalog(path.join(dir, "builtin"), H.buildFiles((doc) => {
      doc.version = "1.1.0";
      enforceControl(doc);
    }));
    assert.throws(() => resolveCatalog({ version: "1.1.0", roots: [root] }), { code: "CATALOG_CONFORMANCE_FAILED" });
    const snap = resolveCatalog({
      version: "1.1.0",
      roots: [root],
      approvedConformanceSuites: ["test/engineering/contract/search-input-rate@1.0.0"],
    });
    assert.equal(snap.conformance.passed, true);
    assert.throws(
      () => resolveCatalog({ version: "1.1.0", roots: [root], approvedConformanceSuites: ["test/engineering/contract/search-input-rate@0.9.0"] }),
      { code: "CATALOG_CONFORMANCE_FAILED" }
    );
  });
});

test("T02.4 enforce sin enforcementContract es inválido incluso antes de conformidad", () => {
  const files = H.buildFiles((doc) => {
    doc.controls[0].supportedLevels = ["off", "warn", "enforce"];
  });
  assert.throws(() => loadCatalogFromFiles(files), (err) => err.code === "CATALOG_CONTRACT" && /enforcementContract/.test(err.message));
});

test("T02.4 presupuestos por momento, perfiles builtin, notas de migración y deprecaciones", () => {
  const base = loadCatalogFromFiles(H.builtinFiles());
  assert.equal(runCatalogConformance(base).passed, true);

  const slow = loadCatalogFromFiles(H.buildFiles((doc) => {
    doc.controls[0].moments[0].budgetMs = 5000;
  }));
  const r1 = runCatalogConformance(slow);
  assert.equal(r1.passed, false);
  assert.ok(r1.checks.some((c) => !c.passed && c.id.endsWith("budget.agent")));

  const noSearch = loadCatalogFromFiles(H.buildFiles((doc) => {
    doc.profiles = doc.profiles.filter((p) => p.id !== "search");
    doc.controls = doc.controls.filter((c) => c.id !== "search.input-rate");
  }));
  assert.equal(runCatalogConformance(noSearch).passed, false);
  assert.equal(runCatalogConformance(noSearch, { requireBuiltinProfiles: false }).passed, true);

  const missingNotes = loadCatalogFromFiles(H.buildFiles((doc) => {
    doc.version = "1.1.0";
    doc.migrations = [{ from: "1.0.0", to: "1.1.0", ref: "notes/no-existe.md" }];
  }));
  assert.equal(runCatalogConformance(missingNotes).passed, false);

  const badReplacement = loadCatalogFromFiles(H.buildFiles((doc) => {
    doc.controls[0].deprecation = { since: "1.0.0", reason: "x", replacement: "search.no-existe" };
  }));
  assert.equal(runCatalogConformance(badReplacement).passed, false);
});

// --- T02.5 gate ----------------------------------------------------------

test("T02.5 gate: misma revisión+config+catálogo ⇒ resolución idéntica", () => {
  withTmp((dir) => {
    const a = resolveCatalog({ version: "1.0.0" });
    // Copia escrita en otro orden y otra ubicación: mismo digest y snapshot.
    const files = H.builtinFiles();
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    const root = H.writeCatalog(path.join(dir, "otra raíz con espacios"), reversed);
    const b = resolveCatalog({ version: "1.0.0", roots: [root] });
    assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
    assert.equal(hashJson(JSON.parse(JSON.stringify(a))), hashJson(JSON.parse(JSON.stringify(b))));
    assert.equal(JSON.stringify(a).includes(dir), false, "la snapshot no expone rutas absolutas");
  });
});

test("T02.5 gate: mismatch o incompatibilidad fallan antes de evaluar", () => {
  let evaluated = false;
  const evaluateRun = (opts) => {
    const snap = resolveCatalog(opts);
    evaluated = true;
    return snap;
  };
  for (const opts of [
    { version: "1.0.0", expectedDigest: `sha256:${"1".repeat(64)}` },
    { version: "1.0.0", runtime: { platform: "sunos" } },
    { version: "latest" },
    { version: "2.0.0" },
  ]) {
    assert.throws(() => evaluateRun(opts));
    assert.equal(evaluated, false);
  }
});
