"use strict";

/**
 * Profile: capacidad funcional declarada sobre una unidad (R2).
 *
 * Los perfiles son declaraciones, no detecciones: `source: "suggested"`
 * existe sólo para que discovery proponga sin activar (R2.2); el resolver de
 * aplicabilidad nunca debe tratar un perfil sugerido como declarado.
 */

const c = require("./common.js");

const SCHEMA_VERSION = 1;
const KEYS = ["schemaVersion", "id", "version", "catalog", "extends", "parametersSchemaRef", "parameters", "source", "provenance"];

function createProfile(input) {
  c.assertObject(input, "profile");
  c.assertKnownKeys(input, KEYS, "profile");
  // Contrato cerrado: sólo `parameters` es libre y se barre en profundidad.
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`profile.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }

  c.assertProfileId(input.id, "profile.id");
  c.assertSemver(input.version, "profile.version");
  const catalog = c.createCatalogRef(input.catalog, "profile.catalog");

  const ext = input.extends === undefined ? [] : input.extends;
  c.assertArray(ext, "profile.extends");
  const extendsRefs = ext.map((r, i) => c.createProfileRef(r, `profile.extends[${i}]`));
  c.assertUnique(extendsRefs, (r) => r.id, "profile.extends");
  if (extendsRefs.some((r) => r.id === input.id)) c.fail("profile.extends no puede referenciarse a sí mismo");

  const parameters = input.parameters === undefined ? {} : input.parameters;
  c.assertObject(parameters, "profile.parameters");
  c.assertNoForbiddenFieldsDeep(parameters, "profile.parameters");

  c.assertEnum(input.source, c.PROFILE_SOURCES, "profile.source");
  const provenance = c.createProvenance(input.provenance, "profile.provenance");
  if (input.source === c.PROFILE_SOURCE.SUGGESTED && provenance.sourceKind !== c.PROVENANCE_KIND.DISCOVERY) {
    c.fail("profile sugerido debe provenir de discovery");
  }
  if (input.source !== c.PROFILE_SOURCE.SUGGESTED && provenance.sourceKind === c.PROVENANCE_KIND.DISCOVERY) {
    c.fail("discovery sólo puede producir perfiles 'suggested'; nunca activarlos (R2.2)");
  }

  const profile = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    version: input.version,
    catalog,
    extends: extendsRefs,
    parameters: c.cloneJson(parameters, "profile.parameters"),
    source: input.source,
    provenance,
  };
  if (input.parametersSchemaRef !== undefined) {
    c.assertRef(input.parametersSchemaRef, "profile.parametersSchemaRef");
    profile.parametersSchemaRef = input.parametersSchemaRef;
  }
  return c.deepFreeze(profile);
}

/** ¿El perfil fue declarado (explícito o heredado explícitamente)? */
function isDeclared(profile) {
  return profile.source === c.PROFILE_SOURCE.EXPLICIT || profile.source === c.PROFILE_SOURCE.INHERITED;
}

module.exports = { SCHEMA_VERSION, createProfile, isDeclared };
