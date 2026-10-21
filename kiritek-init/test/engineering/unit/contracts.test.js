"use strict";

// T01.1–T01.5: contratos engineering, schemas, fixtures y round-trip.

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateAgainst, validate } = require("../../../src/domain/schema-validator.js");
const securityResult = require("../../../src/domain/result.js");
const contracts = require("../../../src/engineering/guardrails/contracts/index.js");
const { valid, invalid, listNames, envelopeInput } = require("../helpers/fixtures.js");

const { createProfile } = contracts.profile;
const { createUnit } = contracts.unit;
const { createControlDefinition } = contracts.control;
const { createCatalog } = contracts.catalog;
const { createObservation } = contracts.observation;
const { createApplicability } = contracts.applicability;
const { createEngineeringEvidence, evaluateFreshness } = contracts.evidence;
const { createPracticeInput } = contracts.practiceInput;
const { createEngineeringPolicyResult, parsePolicyResultV1, operationalResult } = contracts.policyResult;
const env = contracts.resultEnvelope;

const EXT = { extended: true };

/** prefijo de fixture → [schema, constructor] */
const KINDS = {
  profile: ["engineering/profile", createProfile],
  unit: ["engineering/unit", createUnit],
  control: ["engineering/control", createControlDefinition],
  catalog: ["engineering/catalog", createCatalog],
  observation: ["engineering/observation", createObservation],
  applicability: ["engineering/applicability", createApplicability],
  evidence: ["engineering/evidence", createEngineeringEvidence],
  envelope: ["engineering/result-envelope", env.parseResultEnvelope],
  "result-envelope": ["engineering/result-envelope", env.parseResultEnvelope],
};

function kindOf(name) {
  return KINDS[name.split(".")[0]];
}

function practiceInputFixture() {
  return {
    event: "pr",
    repository: { rootHash: valid("envelope.deny-eligible").unit.rootHash },
    actorType: "ci",
    revision: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      baseCommit: "89abcdef0123456789abcdef0123456789abcdef",
      range: "base..head",
    },
    scope: { paths: ["apps/search web/src/search.ts"], scopeHash: valid("observation.search-behavior").scopeHash },
    unit: valid("unit.search-web"),
    profileRefs: [{ id: "search", version: "1.0.0" }],
    control: valid("control.search-input-rate"),
    level: "warn",
    effectiveConfig: { minChars: 3, cadence: { strategy: "equivalent", windowMs: 250 } },
    configHash: valid("observation.search-behavior").configHash,
    provenance: { level: { sourceKind: "repo", sourceRef: "kiritek-engineering.config.json" } },
    catalog: valid("envelope.deny-eligible").catalog,
    observations: [valid("observation.search-behavior")],
    applicability: valid("applicability.applicable"),
    clockRef: "2026-10-01T12:00:00Z",
    platformKey: "linux-x64-node20",
  };
}

// --- T01.1 / T01.5: fixtures válidos, schema y round-trip -----------------

for (const name of listNames("valid")) {
  test(`T01.5 fixture válido ${name}: schema + constructor + round-trip JSON estable`, () => {
    const [schema, construct] = kindOf(name);
    const fixture = valid(name);
    const check = validateAgainst(schema, fixture, EXT);
    assert.deepEqual(check.errors, [], `schema ${schema}`);

    const built = construct(fixture);
    assert.ok(Object.isFrozen(built), "el contrato debe quedar congelado");
    const roundTrip = JSON.parse(JSON.stringify(built));
    assert.deepEqual(roundTrip, fixture, "round-trip debe ser idéntico al fixture canónico");
    assert.equal(validateAgainst(schema, roundTrip, EXT).valid, true);
    // Reconstruir desde el round-trip es idempotente.
    assert.deepEqual(JSON.parse(JSON.stringify(construct(roundTrip))), fixture);
  });
}

test("T01.1 PracticeInput: fixture compuesto valida contra schema y constructor", () => {
  const input = practiceInputFixture();
  const built = createPracticeInput(input);
  const serialized = JSON.parse(JSON.stringify(built));
  assert.deepEqual(validateAgainst("engineering/practice-input", serialized, EXT).errors, []);
  assert.equal(built.schemaVersion, 1);
  assert.equal(built.observations.length, 1);
  assert.ok(Object.isFrozen(built.observations[0].facts));
});

test("T01.1 PracticeInput: no transporta rutas absolutas ni observaciones de otra identidad", () => {
  const abs = practiceInputFixture();
  abs.scope.paths = ["/Users/someone/repo/apps/x.ts"];
  assert.throws(() => createPracticeInput(abs), { code: "ABSOLUTE_PATH" });

  const rootField = practiceInputFixture();
  rootField.repositoryRoot = "/Users/someone/repo";
  assert.throws(() => createPracticeInput(rootField), { code: "UNKNOWN_PROPERTY" });

  const otherUnit = practiceInputFixture();
  otherUnit.observations[0].unitId = "acme/other";
  assert.throws(() => createPracticeInput(otherUnit), { code: "IDENTITY_MISMATCH" });

  const prNoBase = practiceInputFixture();
  delete prNoBase.revision.baseCommit;
  assert.throws(() => createPracticeInput(prNoBase), /baseCommit/);
});

test("T01.1 Catalog: perfiles builtin presentes y referencias cruzadas validadas", () => {
  const cat = createCatalog(valid("catalog.minimal"));
  assert.deepEqual(
    cat.profiles.map((p) => p.id),
    ["web", "mobile-app", "search", "module-launch"]
  );
  const broken = valid("catalog.minimal");
  broken.controls[0].profiles = { allOf: ["acme/unknown"] };
  assert.throws(() => createCatalog(broken), { code: "UNKNOWN_REFERENCE" });
  const dup = valid("catalog.minimal");
  dup.controls.push(dup.controls[0]);
  assert.throws(() => createCatalog(dup), { code: "DUPLICATE" });
});

test("T01.1 ControlDefinition: enforce exige contrato aprobado sin evidencia heurística", () => {
  const noContract = valid("control.search-input-rate");
  delete noContract.enforcementContract;
  assert.throws(() => createControlDefinition(noContract), { code: "ENFORCE_WITHOUT_CONTRACT" });

  const heuristic = valid("control.search-input-rate");
  heuristic.enforcementContract.evidenceTypes = ["heuristic"];
  assert.throws(() => createControlDefinition(heuristic), { code: "HEURISTIC_ENFORCEMENT" });

  const warnOnly = valid("control.search-input-rate");
  warnOnly.supportedLevels = ["off", "warn"];
  delete warnOnly.enforcementContract;
  assert.equal(createControlDefinition(warnOnly).enforcementContract, undefined);

  const denyFallback = valid("control.search-input-rate");
  denyFallback.moments[0].fallback = "deny";
  assert.throws(() => createControlDefinition(denyFallback), /fallback/);
});

test("T01.1 Profile: discovery sólo sugiere, nunca activa (R2.2)", () => {
  const p = valid("profile.search");
  p.provenance = { sourceKind: "discovery", sourceRef: "package.json" };
  assert.throws(() => createProfile(p), /discovery/);
  p.source = "suggested";
  const suggested = createProfile(p);
  assert.equal(contracts.profile.isDeclared(suggested), false);
  assert.equal(contracts.profile.isDeclared(createProfile(valid("profile.search"))), true);
});

test("T01.1 Observation: estado no completo exige limitación y no puede ser determinista", () => {
  const partial = valid("observation.search-behavior");
  partial.status = "partial";
  assert.throws(() => createObservation(partial), /limitación/);
  partial.limitations = [{ code: "TIMEOUT", message: "escenario 3 excedió presupuesto" }];
  assert.throws(() => createObservation(partial), /determinista/);
  partial.confidence = "medium";
  assert.equal(createObservation(partial).status, "partial");

  const heuristic = valid("observation.search-behavior");
  heuristic.evidenceClass = "heuristic";
  assert.throws(() => createObservation(heuristic), { code: "HEURISTIC_DETERMINISTIC" });
});

test("T01.1 Evidence: manual declara reviewer y no se etiqueta como automatizada (R7.6)", () => {
  const manual = valid("evidence.deterministic");
  manual.evidenceClass = "manual";
  manual.confidence = "high";
  assert.throws(() => createEngineeringEvidence(manual), /manualReview/);
  manual.manualReview = {
    reviewer: "qa-lead",
    scope: "acme/search-web",
    checklistRef: "docs/checklists/search.md",
    reviewedAt: "2026-10-01T10:00:00Z",
    expiresAt: "2026-10-08T10:00:00Z",
    reference: "JIRA-123",
  };
  const ev = createEngineeringEvidence(manual);
  assert.deepEqual(validateAgainst("engineering/evidence", JSON.parse(JSON.stringify(ev)), EXT).errors, []);

  const fake = valid("evidence.deterministic");
  fake.manualReview = manual.manualReview;
  assert.throws(() => createEngineeringEvidence(fake), /automatización/);
});

test("T01.1 Evidence: freshness exige misma identidad y vigencia (R7.3–R7.4)", () => {
  const ev = createEngineeringEvidence(valid("evidence.deterministic"));
  const expected = {
    revision: ev.revision,
    scopeHash: ev.scopeHash,
    configHash: ev.configHash,
    catalogDigest: ev.catalog.digest,
    unitId: ev.unitId,
    controlId: ev.control.id,
    controlVersion: ev.control.version,
  };
  const now = () => Date.parse("2026-10-01T13:00:00Z");
  assert.equal(evaluateFreshness(ev, expected, { now }).freshness, "fresh");
  for (const key of Object.keys(expected)) {
    const r = evaluateFreshness(ev, { ...expected, [key]: "otro" }, { now });
    assert.equal(r.freshness, "stale", `${key} distinto debe dejarla stale`);
  }
  assert.equal(evaluateFreshness(ev, expected, { now: () => Date.parse("2026-10-03T00:00:00Z") }).freshness, "stale");
  assert.equal(evaluateFreshness(null, expected).freshness, "missing");
});

test("T01.1 Evidence: id/clock inyectables para pruebas deterministas", () => {
  const input = valid("evidence.deterministic");
  delete input.id;
  delete input.createdAt;
  delete input.expiresAt;
  const ev = createEngineeringEvidence(input, { clock: () => "2026-10-01T00:00:00Z", idGenerator: () => "ev-fixed" });
  assert.equal(ev.id, "ev-fixed");
  assert.equal(ev.createdAt, "2026-10-01T00:00:00Z");
});

// --- T01.2: PolicyResult v1 interno + envelope v2 ----------------------

test("T01.2 PolicyResult v1 se mantiene intacto: el payload valida contra result.schema.json", () => {
  const e = env.parseResultEnvelope(valid("envelope.deny-eligible"));
  assert.equal(e.result.schemaVersion, securityResult.SCHEMA_VERSION);
  assert.deepEqual(validateAgainst("result", JSON.parse(JSON.stringify(e.result))).errors, []);
  // El envelope transporta dominio, pack, catálogo, unidad, perfiles, momento,
  // confianza, aplicabilidad, frescura y elegibilidad de bloqueo.
  for (const key of ["domain", "packId", "catalog", "unit", "profiles", "moment", "confidence", "applicability", "evidenceFreshness", "blockingEligible"]) {
    assert.ok(key in e, `envelope debe incluir ${key}`);
  }
  // El payload v1 no admite contexto engineering ad hoc.
  const polluted = { ...JSON.parse(JSON.stringify(e.result)), domain: "engineering" };
  assert.equal(validateAgainst("result", polluted).valid, false);
});

test("T01.2 adaptador PolicyResult: exige controlId namespaceado y no altera createResult security", () => {
  assert.throws(() => createEngineeringPolicyResult({ controlId: "search", decision: "allow" }), { code: "ID_NOT_NAMESPACED" });
  const r = createEngineeringPolicyResult({ controlId: "search.input-rate", decision: "allow", toolStatus: "ok" });
  assert.deepEqual(r, securityResult.createResult({ controlId: "search.input-rate", decision: "allow", toolStatus: "ok" }));
  // security sigue aceptando sus IDs propios sin restricción engineering.
  assert.equal(securityResult.createResult({ controlId: "secrets", decision: "allow" }).controlId, "secrets");
  assert.throws(() => createEngineeringPolicyResult({ controlId: "a.b", decision: "warn", reason: "x", query: "q" }), {
    code: "FORBIDDEN_FIELD",
  });
  assert.equal(parsePolicyResultV1(JSON.parse(JSON.stringify(r))).decision, "allow");
});

test("T01.2 proyección operativa: unavailable/timeout se expresan como error v1, nunca allow/deny", () => {
  const r = operationalResult("search.input-rate", "timeout", "suite excedió 120s");
  assert.equal(r.decision, "error");
  assert.equal(r.toolStatus, "unavailable");
  assert.match(r.reason, /^timeout:/);
});

// --- T01.3: rechazo de entradas inválidas -------------------------------

for (const name of listNames("invalid")) {
  test(`T01.3 fixture inválido ${name}: rechazado por schema y por constructor`, () => {
    const [schema, construct] = kindOf(name);
    const fixture = invalid(name);
    assert.equal(validateAgainst(schema, fixture, EXT).valid, false, "schema debe rechazar");
    assert.throws(() => construct(fixture), "constructor debe rechazar");
  });
}

test("T01.3 rechaza propiedades desconocidas en cada contrato", () => {
  for (const [name, [, construct]] of [
    ["profile.search", KINDS.profile],
    ["unit.search-web", KINDS.unit],
    ["control.search-input-rate", KINDS.control],
    ["catalog.minimal", KINDS.catalog],
    ["observation.search-behavior", KINDS.observation],
    ["applicability.applicable", KINDS.applicability],
    ["evidence.deterministic", KINDS.evidence],
  ]) {
    const obj = valid(name);
    obj.surprise = 1;
    assert.throws(() => construct(obj), { code: "UNKNOWN_PROPERTY" }, name);
  }
  const e = envelopeInput();
  e.surprise = 1;
  assert.throws(() => env.createResultEnvelope(e), { code: "UNKNOWN_PROPERTY" });
});

test("T01.3 rechaza IDs no namespaceados, versiones inválidas, rutas absolutas y estados desconocidos", () => {
  const cases = [
    [() => { const u = valid("unit.search-web"); u.id = "search-web"; return createUnit(u); }, "ID_NOT_NAMESPACED"],
    [() => { const p = valid("profile.search"); p.id = "Checkout"; return createProfile(p); }, "ID_NOT_NAMESPACED"],
    [() => { const p = valid("profile.search"); p.version = "^1.0.0"; return createProfile(p); }, "INVALID_VERSION"],
    [() => { const p = valid("profile.search"); p.version = "latest"; return createProfile(p); }, "INVALID_VERSION"],
    [() => { const u = valid("unit.search-web"); u.root = "C:/repo/apps"; return createUnit(u); }, "ABSOLUTE_PATH"],
    [() => { const u = valid("unit.search-web"); u.root = "\\\\server\\share"; return createUnit(u); }, "ABSOLUTE_PATH"],
    [() => { const u = valid("unit.search-web"); u.root = "apps/../../etc"; return createUnit(u); }, "PATH_ESCAPE"],
    [() => { const u = valid("unit.search-web"); u.owns = ["/abs/**"]; return createUnit(u); }, "ABSOLUTE_PATH"],
    [() => { const o = valid("observation.search-behavior"); o.status = "ok"; return createObservation(o); }, "UNRECOGNIZED_STATE"],
    [() => { const a = valid("applicability.applicable"); a.status = "maybe"; return createApplicability(a); }, "UNRECOGNIZED_STATE"],
    [() => { const e = envelopeInput(); e.state = "skipped"; return env.createResultEnvelope(e); }, "UNRECOGNIZED_STATE"],
    [() => { const e = envelopeInput(); e.level = "block"; return env.createResultEnvelope(e); }, "UNRECOGNIZED_STATE"],
    [() => { const c = valid("catalog.minimal"); c.version = "1.0"; return createCatalog(c); }, "INVALID_VERSION"],
    [() => { const e = envelopeInput(); e.catalog.digest = "md5:abc"; return env.createResultEnvelope(e); }, "INVALID_HASH"],
  ];
  for (const [fn, code] of cases) assert.throws(fn, { code });
});

test("T01.3 acepta rutas con espacios y Unicode (R24)", () => {
  const u = valid("unit.search-web");
  u.root = "apps/búsqueda web";
  u.owns = ["apps/búsqueda web/**"];
  assert.equal(createUnit(u).root, "apps/búsqueda web");
  assert.equal(validateAgainst("engineering/unit", JSON.parse(JSON.stringify(createUnit(u))), EXT).valid, true);
});

test("T01.3 campos sensibles (query/payload/token/prompt/code) rechazados en profundidad", () => {
  for (const field of ["query", "payload", "deviceToken", "prompt", "code", "email", "diff"]) {
    const o = valid("observation.search-behavior");
    o.facts.nested = { [field]: "canario-sintético" };
    assert.throws(() => createObservation(o), { code: "FORBIDDEN_FIELD" }, field);
  }
});

test("T01.3 collector no puede emitir decisiones (R6.1)", () => {
  const o = valid("observation.search-behavior");
  o.facts.blockingEligible = true;
  assert.throws(() => createObservation(o), { code: "COLLECTOR_DECISION" });
});

// --- T01.4: estados independientes, ninguno equivale a allow ------------

function abstentionEnvelope(state, overrides = {}) {
  const e = envelopeInput("envelope.not-applicable");
  e.state = state;
  if (state === "off") e.level = "off";
  if (state !== "not_applicable") e.applicability = null;
  if (state === "stale") {
    e.evidenceCompleteness = "complete";
    e.evidenceFreshness = "stale";
    e.evidenceClass = "deterministic";
    e.evidence = valid("envelope.deny-eligible").evidence;
  }
  if (state === "conflict") {
    e.evidenceCompleteness = "partial";
    e.evidenceFreshness = "conflict";
    e.evidenceClass = "deterministic";
    e.evidence = valid("envelope.deny-eligible").evidence;
  }
  e.diagnostics = [{ code: state.toUpperCase(), message: `estado ${state}` }];
  return Object.assign(e, overrides);
}

const NON_EVALUATED = ["off", "not_evaluated", "not_applicable", "unknown", "unavailable", "timeout", "conflict", "stale"];

test("T01.4 los ocho estados no evaluados son distintos y válidos sin payload", () => {
  assert.equal(new Set(NON_EVALUATED).size, 8);
  for (const state of NON_EVALUATED) {
    assert.ok(env.EVALUATION_STATES.includes(state));
    const e = env.createResultEnvelope(abstentionEnvelope(state));
    assert.equal(e.state, state);
    assert.equal(e.result, null);
    assert.equal(e.blockingEligible, false, `${state} nunca es elegible para bloqueo`);
    assert.equal(env.isVerifiedConformity(e), false, `${state} no equivale a allow verificado`);
  }
});

test("T01.4 ningún estado no evaluado admite allow ni deny", () => {
  const allow = { schemaVersion: 1, controlId: "search.input-rate", decision: "allow", severity: "info", toolStatus: "ok", findings: [] };
  const deny = valid("envelope.deny-eligible").result;
  for (const state of NON_EVALUATED) {
    assert.throws(() => env.createResultEnvelope(abstentionEnvelope(state, { result: allow })), { code: "STATE_INCONSISTENT" }, `${state}+allow`);
    assert.throws(() => env.createResultEnvelope(abstentionEnvelope(state, { result: deny, findingEvidence: valid("envelope.deny-eligible").findingEvidence })), `${state}+deny`);
  }
});

test("T01.4 estados operativos admiten warn/error; abstenciones no admiten payload", () => {
  const error = { schemaVersion: 1, controlId: "search.input-rate", decision: "error", severity: "info", toolStatus: "unavailable", findings: [], reason: "timeout: suite" };
  for (const state of env.OPERATIONAL_STATES) {
    assert.equal(env.createResultEnvelope(abstentionEnvelope(state, { result: error })).result.decision, "error");
  }
  for (const state of env.ABSTENTION_STATES) {
    assert.throws(() => env.createResultEnvelope(abstentionEnvelope(state, { result: error })), { code: "STATE_INCONSISTENT" });
  }
});

test("T01.4 level off ⇔ state off; estados no evaluados requieren diagnóstico", () => {
  assert.throws(() => env.createResultEnvelope(abstentionEnvelope("off", { level: "warn" })), { code: "STATE_INCONSISTENT" });
  assert.throws(() => env.createResultEnvelope(abstentionEnvelope("unknown", { level: "off" })), { code: "STATE_INCONSISTENT" });
  assert.throws(() => env.createResultEnvelope(abstentionEnvelope("timeout", { diagnostics: [] })), { code: "STATE_INCONSISTENT" });
});

test("T01.4 evaluated exige aplicabilidad confirmada", () => {
  const e = envelopeInput();
  e.applicability = { ...e.applicability, status: "unknown", confidence: "unknown", reasons: [{ code: "AMBIGUOUS", message: "señales contradictorias" }] };
  assert.throws(() => env.createResultEnvelope(e), { code: "STATE_INCONSISTENT" });
});

test("T01.4 supresión conserva deuda: no se presenta como allow limpio", () => {
  const e = envelopeInput();
  e.level = "warn";
  e.control = { ...e.control };
  e.result.decision = "allow";
  e.result.findings = [];
  delete e.result.reason;
  e.result.severity = "info";
  e.findingEvidence = [];
  e.suppressed = [{ kind: "governed-na", ref: ".kiritek/engineering/not-applicable/search.json", expiresAt: "2026-12-01T00:00:00Z" }];
  assert.throws(() => env.createResultEnvelope(e), { code: "SUPPRESSION_AS_ALLOW" });
  const w = envelopeInput();
  w.suppressed = [{ kind: "waiver", ref: "W-1" , expiresAt: "2026-12-01T00:00:00Z" }];
  assert.throws(() => env.createResultEnvelope(w), { code: "WAIVER_UNSCOPED" });
});

// --- Validador: modo extendido opt-in no altera security ---------------

test("validador: palabras clave extendidas sólo con opt-in (schemas security sin cambios)", () => {
  const schema = { type: "object", properties: { a: { type: "string", pattern: "^x$" }, l: { type: "array", minItems: 2 } } };
  const value = { a: "y", l: [] };
  assert.equal(validate(value, schema).valid, true, "modo por defecto conserva el comportamiento previo");
  const ext = validate(value, schema, EXT);
  assert.equal(ext.valid, false);
  assert.ok(ext.errors.some((e) => /pattern/.test(e)));
  assert.ok(ext.errors.some((e) => /minItems/.test(e)));
  assert.throws(() => validate({}, { $ref: "result.schema.json" }), /sólo locales/);
  assert.throws(() => validate({}, { $ref: "../x.schema.json" }, EXT), /no permitido/);
});
