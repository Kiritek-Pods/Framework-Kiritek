"use strict";

/**
 * PracticeInput: entrada única y autocontenida de un evaluator puro (R6.2,
 * R6.6). Todo lo que el evaluator necesita viaja aquí — incluido el reloj
 * como valor (`clockRef`) — para que no lea filesystem, red ni reloj real.
 *
 * Desviación consciente del diseño §5: no se transporta `repositoryRoot`
 * (ruta absoluta). El evaluator no la necesita y su presencia violaría la
 * regla de rutas relativas; se usa `repository.rootHash`.
 */

const c = require("./common.js");
const { createUnit } = require("./unit.js");
const { createControlDefinition } = require("./control.js");
const { createObservation, assertRevision } = require("./observation.js");
const { createApplicability } = require("./applicability.js");

const SCHEMA_VERSION = 1;
const ACTOR_TYPES = Object.freeze(["human", "agent", "ci", "release"]);
const KEYS = [
  "schemaVersion",
  "event",
  "repository",
  "actorType",
  "revision",
  "scope",
  "unit",
  "profileRefs",
  "control",
  "level",
  "effectiveConfig",
  "configHash",
  "provenance",
  "catalog",
  "observations",
  "applicability",
  "clockRef",
  "platformKey",
];

function createPracticeInput(input) {
  c.assertObject(input, "practiceInput");
  c.assertKnownKeys(input, KEYS, "practiceInput");
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`practiceInput.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }

  c.assertEnum(input.event, c.MOMENTS, "practiceInput.event");
  c.assertObject(input.repository, "practiceInput.repository");
  c.assertKnownKeys(input.repository, ["rootHash"], "practiceInput.repository");
  c.assertSha256(input.repository.rootHash, "practiceInput.repository.rootHash");
  c.assertEnum(input.actorType, ACTOR_TYPES, "practiceInput.actorType");

  c.assertObject(input.revision, "practiceInput.revision");
  c.assertKnownKeys(input.revision, ["commit", "baseCommit", "range", "dirtyState"], "practiceInput.revision");
  assertRevision(input.revision.commit, "practiceInput.revision.commit");
  const revision = { commit: input.revision.commit };
  if (input.revision.baseCommit !== undefined) {
    assertRevision(input.revision.baseCommit, "practiceInput.revision.baseCommit");
    revision.baseCommit = input.revision.baseCommit;
  }
  if (input.revision.range !== undefined) {
    c.assertString(input.revision.range, "practiceInput.revision.range");
    revision.range = input.revision.range;
  }
  if (input.revision.dirtyState !== undefined) {
    c.assertEnum(input.revision.dirtyState, ["clean", "staged", "dirty"], "practiceInput.revision.dirtyState");
    revision.dirtyState = input.revision.dirtyState;
  }
  if (input.event === c.MOMENT.PR && revision.baseCommit === undefined) {
    c.fail("practiceInput de PR requiere revision.baseCommit (rango completo)");
  }

  c.assertObject(input.scope, "practiceInput.scope");
  c.assertKnownKeys(input.scope, ["paths", "scopeHash", "artifactRef"], "practiceInput.scope");
  c.assertArray(input.scope.paths, "practiceInput.scope.paths");
  input.scope.paths.forEach((p, i) => c.assertRepoRelativePath(p, `practiceInput.scope.paths[${i}]`));
  c.assertSha256(input.scope.scopeHash, "practiceInput.scope.scopeHash");
  const scope = { paths: [...input.scope.paths], scopeHash: input.scope.scopeHash };
  if (input.scope.artifactRef !== undefined) {
    c.assertRef(input.scope.artifactRef, "practiceInput.scope.artifactRef");
    scope.artifactRef = input.scope.artifactRef;
  }

  const unit = createUnit(input.unit);
  c.assertArray(input.profileRefs, "practiceInput.profileRefs");
  const profileRefs = input.profileRefs.map((r, i) => c.createProfileRef(r, `practiceInput.profileRefs[${i}]`));
  const control = createControlDefinition(input.control);
  c.assertEnum(input.level, c.LEVELS, "practiceInput.level");
  if (!control.supportedLevels.includes(input.level)) {
    c.fail(`practiceInput.level '${input.level}' no soportado por ${control.id}`, "LEVEL_NOT_SUPPORTED");
  }
  c.assertObject(input.effectiveConfig, "practiceInput.effectiveConfig");
  c.assertNoForbiddenFieldsDeep(input.effectiveConfig, "practiceInput.effectiveConfig");
  c.assertSha256(input.configHash, "practiceInput.configHash");
  c.assertObject(input.provenance, "practiceInput.provenance");
  const provenance = {};
  for (const [k, v] of Object.entries(input.provenance)) provenance[k] = c.createProvenance(v, `practiceInput.provenance.${k}`);
  const catalog = c.createCatalogRef(input.catalog, "practiceInput.catalog");

  c.assertArray(input.observations, "practiceInput.observations");
  const observations = input.observations.map((o) => createObservation(o));
  for (const o of observations) {
    if (o.unitId !== unit.id || o.controlId !== control.id) {
      c.fail(`observation ${o.observationId} no corresponde a la unidad/control evaluados`, "IDENTITY_MISMATCH");
    }
  }
  const applicability = createApplicability(input.applicability);
  if (applicability.unitId !== unit.id || applicability.controlId !== control.id || applicability.moment !== input.event) {
    c.fail("applicability no corresponde a la unidad/control/momento evaluados", "IDENTITY_MISMATCH");
  }

  c.assertIso(input.clockRef, "practiceInput.clockRef");
  c.assertString(input.platformKey, "practiceInput.platformKey");

  return c.deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    event: input.event,
    repository: { rootHash: input.repository.rootHash },
    actorType: input.actorType,
    revision,
    scope,
    unit,
    profileRefs,
    control,
    level: input.level,
    effectiveConfig: c.cloneJson(input.effectiveConfig, "practiceInput.effectiveConfig"),
    configHash: input.configHash,
    provenance,
    catalog,
    observations,
    applicability,
    clockRef: input.clockRef,
    platformKey: input.platformKey,
  });
}

module.exports = { SCHEMA_VERSION, ACTOR_TYPES, createPracticeInput };
