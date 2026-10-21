"use strict";

/**
 * ControlDefinition: contrato declarativo de un control del catálogo (R4, R8).
 *
 * Invariante clave: un control sólo puede declarar `enforce` entre sus
 * niveles soportados si trae `enforcementContract` con versión aprobada,
 * tipos de evidencia deterministas y suite de conformidad (R3.7, R8.5).
 */

const c = require("./common.js");

const SCHEMA_VERSION = 1;
const COST_CLASSES = Object.freeze(["tiny", "small", "medium", "large"]);
const MOMENT_SCOPES = Object.freeze(["change", "full", "artifact"]);
const KEYS = [
  "schemaVersion",
  "id",
  "version",
  "contractVersion",
  "profiles",
  "moments",
  "parametersSchemaRef",
  "supportedLevels",
  "defaults",
  "enforcementContract",
  "collectors",
  "normalizer",
  "applicability",
  "evaluator",
  "costClass",
  "timeoutMs",
  "cachePolicy",
  "freshness",
  "permissions",
  "documentationRef",
  "deprecation",
];

function profileExpression(input) {
  c.assertObject(input, "control.profiles");
  c.assertKnownKeys(input, ["allOf", "anyOf"], "control.profiles");
  const out = {};
  for (const key of ["allOf", "anyOf"]) {
    if (input[key] === undefined) continue;
    c.assertArray(input[key], `control.profiles.${key}`);
    if (input[key].length === 0) c.fail(`control.profiles.${key} no puede estar vacío`);
    input[key].forEach((p, i) => c.assertProfileId(p, `control.profiles.${key}[${i}]`));
    c.assertUnique(input[key], (p) => p, `control.profiles.${key}`);
    out[key] = [...input[key]];
  }
  if (!out.allOf && !out.anyOf) c.fail("control.profiles requiere allOf o anyOf: todo control depende de perfiles explícitos");
  return out;
}

function momentContract(input, i) {
  const label = `control.moments[${i}]`;
  c.assertObject(input, label);
  c.assertKnownKeys(input, ["moment", "scope", "network", "budgetMs", "fallback"], label);
  c.assertEnum(input.moment, c.MOMENTS, `${label}.moment`);
  c.assertEnum(input.scope, MOMENT_SCOPES, `${label}.scope`);
  c.assertBoolean(input.network, `${label}.network`);
  c.assertPositiveInt(input.budgetMs, `${label}.budgetMs`);
  // El fallback ante timeout/indisponibilidad nunca puede ser deny de política.
  c.assertEnum(input.fallback, ["warn", "error-operational", "defer-to-later-surface"], `${label}.fallback`);
  return { moment: input.moment, scope: input.scope, network: input.network, budgetMs: input.budgetMs, fallback: input.fallback };
}

function enforcementContract(input) {
  c.assertObject(input, "control.enforcementContract");
  c.assertKnownKeys(input, ["evidenceTypes", "conformanceSuite", "approvedVersion", "moments"], "control.enforcementContract");
  c.assertArray(input.evidenceTypes, "control.enforcementContract.evidenceTypes");
  if (input.evidenceTypes.length === 0) c.fail("control.enforcementContract.evidenceTypes no puede estar vacío");
  input.evidenceTypes.forEach((t, i) => {
    if (t === c.EVIDENCE_CLASS.HEURISTIC) {
      c.fail("control.enforcementContract no puede aceptar evidencia heurística (R8.1)", "HEURISTIC_ENFORCEMENT");
    }
    c.assertEnum(t, [c.EVIDENCE_CLASS.DETERMINISTIC, c.EVIDENCE_CLASS.MANUAL], `control.enforcementContract.evidenceTypes[${i}]`);
  });
  c.assertRef(input.conformanceSuite, "control.enforcementContract.conformanceSuite");
  c.assertSemver(input.approvedVersion, "control.enforcementContract.approvedVersion");
  c.assertArray(input.moments, "control.enforcementContract.moments");
  if (input.moments.length === 0) c.fail("control.enforcementContract.moments no puede estar vacío");
  input.moments.forEach((m, i) => c.assertEnum(m, c.MOMENTS, `control.enforcementContract.moments[${i}]`));
  return {
    evidenceTypes: [...input.evidenceTypes],
    conformanceSuite: input.conformanceSuite,
    approvedVersion: input.approvedVersion,
    moments: [...input.moments],
  };
}

function permissions(input) {
  const p = input === undefined ? {} : input;
  c.assertObject(p, "control.permissions");
  c.assertKnownKeys(p, ["filesystemRead", "networkHosts", "envNames", "processes"], "control.permissions");
  const out = {};
  for (const key of ["filesystemRead", "networkHosts", "envNames", "processes"]) {
    const list = p[key] === undefined ? [] : p[key];
    c.assertArray(list, `control.permissions.${key}`);
    list.forEach((v, i) => {
      if (key === "filesystemRead") c.assertRepoRelativePath(v, `control.permissions.${key}[${i}]`, { allowGlob: true });
      else c.assertString(v, `control.permissions.${key}[${i}]`);
    });
    out[key] = [...list];
  }
  return out;
}

function createControlDefinition(input) {
  c.assertObject(input, "control");
  c.assertKnownKeys(input, KEYS, "control");
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`control.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }

  c.assertControlId(input.id, "control.id");
  c.assertSemver(input.version, "control.version");
  c.assertSemver(input.contractVersion, "control.contractVersion");

  c.assertArray(input.moments, "control.moments");
  if (input.moments.length === 0) c.fail("control.moments no puede estar vacío");
  const moments = input.moments.map(momentContract);
  c.assertUnique(moments, (m) => m.moment, "control.moments");

  c.assertArray(input.supportedLevels, "control.supportedLevels");
  input.supportedLevels.forEach((l, i) => c.assertEnum(l, c.LEVELS, `control.supportedLevels[${i}]`));
  c.assertUnique(input.supportedLevels, (l) => l, "control.supportedLevels");
  for (const required of [c.LEVEL.OFF, c.LEVEL.WARN]) {
    if (!input.supportedLevels.includes(required)) c.fail(`control.supportedLevels debe incluir '${required}'`);
  }
  const supportsEnforce = input.supportedLevels.includes(c.LEVEL.ENFORCE);
  if (supportsEnforce && input.enforcementContract === undefined) {
    c.fail("control declara 'enforce' sin enforcementContract aprobado (R3.7)", "ENFORCE_WITHOUT_CONTRACT");
  }
  if (!supportsEnforce && input.enforcementContract !== undefined) {
    c.fail("control trae enforcementContract pero no soporta 'enforce'");
  }

  // Defaults inmutables del catálogo: base de la precedencia de config (T03).
  // Nunca `enforce`: la promoción es explícita por unidad/control (R21).
  c.assertObject(input.defaults, "control.defaults");
  c.assertKnownKeys(input.defaults, ["level", "parameters"], "control.defaults");
  c.assertEnum(input.defaults.level, [c.LEVEL.OFF, c.LEVEL.WARN], "control.defaults.level");
  c.assertObject(input.defaults.parameters, "control.defaults.parameters");
  c.assertNoForbiddenFieldsDeep(input.defaults.parameters, "control.defaults.parameters");

  c.assertArray(input.collectors, "control.collectors");
  if (input.collectors.length === 0) c.fail("control.collectors no puede estar vacío");
  input.collectors.forEach((r, i) => c.assertRef(r, `control.collectors[${i}]`));
  for (const key of ["normalizer", "applicability", "evaluator", "parametersSchemaRef", "documentationRef"]) {
    c.assertRef(input[key], `control.${key}`);
  }

  c.assertEnum(input.costClass, COST_CLASSES, "control.costClass");
  c.assertPositiveInt(input.timeoutMs, "control.timeoutMs");

  c.assertObject(input.cachePolicy, "control.cachePolicy");
  c.assertKnownKeys(input.cachePolicy, ["enabled", "ttlSeconds"], "control.cachePolicy");
  c.assertBoolean(input.cachePolicy.enabled, "control.cachePolicy.enabled");
  c.assertNonNegativeInt(input.cachePolicy.ttlSeconds, "control.cachePolicy.ttlSeconds");

  c.assertObject(input.freshness, "control.freshness");
  c.assertKnownKeys(input.freshness, ["maxAgeSeconds"], "control.freshness");
  c.assertPositiveInt(input.freshness.maxAgeSeconds, "control.freshness.maxAgeSeconds");

  const def = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    version: input.version,
    contractVersion: input.contractVersion,
    profiles: profileExpression(input.profiles),
    moments,
    parametersSchemaRef: input.parametersSchemaRef,
    supportedLevels: [...input.supportedLevels],
    defaults: { level: input.defaults.level, parameters: c.cloneJson(input.defaults.parameters, "control.defaults.parameters") },
    collectors: [...input.collectors],
    normalizer: input.normalizer,
    applicability: input.applicability,
    evaluator: input.evaluator,
    costClass: input.costClass,
    timeoutMs: input.timeoutMs,
    cachePolicy: { enabled: input.cachePolicy.enabled, ttlSeconds: input.cachePolicy.ttlSeconds },
    freshness: { maxAgeSeconds: input.freshness.maxAgeSeconds },
    permissions: permissions(input.permissions),
    documentationRef: input.documentationRef,
  };
  if (input.enforcementContract !== undefined) {
    def.enforcementContract = enforcementContract(input.enforcementContract);
    for (const m of def.enforcementContract.moments) {
      if (!moments.some((x) => x.moment === m)) c.fail(`control.enforcementContract.moments incluye '${m}' no declarado en moments`);
    }
  }
  if (input.deprecation !== undefined) {
    c.assertObject(input.deprecation, "control.deprecation");
    c.assertKnownKeys(input.deprecation, ["since", "reason", "replacement"], "control.deprecation");
    c.assertSemver(input.deprecation.since, "control.deprecation.since");
    c.assertString(input.deprecation.reason, "control.deprecation.reason");
    def.deprecation = { since: input.deprecation.since, reason: input.deprecation.reason };
    if (input.deprecation.replacement !== undefined) {
      c.assertControlId(input.deprecation.replacement, "control.deprecation.replacement");
      def.deprecation.replacement = input.deprecation.replacement;
    }
  }
  return c.deepFreeze(def);
}

module.exports = { SCHEMA_VERSION, COST_CLASSES, MOMENT_SCOPES, createControlDefinition };
