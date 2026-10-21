"use strict";

/**
 * Unit: unidad evaluable de un repositorio/monorepo (R2.6, R14).
 * `id` es la identidad estable; `root`, `owns` y `excludes` son rutas/globs
 * relativas al repositorio y nunca escapan de él.
 */

const c = require("./common.js");
const { createProfile } = require("./profile.js");

const SCHEMA_VERSION = 1;
const UNIT_KINDS = Object.freeze(["application", "package", "module", "service", "workspace"]);
const KEYS = ["schemaVersion", "id", "root", "kind", "profiles", "owns", "excludes", "dependsOn", "identityAliases", "provenance"];

function createUnit(input) {
  c.assertObject(input, "unit");
  c.assertKnownKeys(input, KEYS, "unit");
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`unit.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }

  c.assertNamespacedId(input.id, "unit.id");
  c.assertRepoRelativePath(input.root, "unit.root");
  c.assertEnum(input.kind, UNIT_KINDS, "unit.kind");

  const profilesIn = input.profiles === undefined ? [] : input.profiles;
  c.assertArray(profilesIn, "unit.profiles");
  const profiles = profilesIn.map((p) => createProfile(p));
  c.assertUnique(profiles, (p) => `${p.id}@${p.version}`, "unit.profiles");

  c.assertArray(input.owns, "unit.owns");
  if (input.owns.length === 0) c.fail("unit.owns requiere al menos un glob");
  input.owns.forEach((g, i) => c.assertRepoRelativePath(g, `unit.owns[${i}]`, { allowGlob: true }));

  const excludes = input.excludes === undefined ? [] : input.excludes;
  c.assertArray(excludes, "unit.excludes");
  excludes.forEach((g, i) => c.assertRepoRelativePath(g, `unit.excludes[${i}]`, { allowGlob: true }));

  const dependsOn = input.dependsOn === undefined ? [] : input.dependsOn;
  c.assertArray(dependsOn, "unit.dependsOn");
  dependsOn.forEach((d, i) => c.assertNamespacedId(d, `unit.dependsOn[${i}]`));
  c.assertUnique(dependsOn, (d) => d, "unit.dependsOn");
  if (dependsOn.includes(input.id)) c.fail("unit.dependsOn no puede incluir la propia unidad");

  const aliases = input.identityAliases === undefined ? [] : input.identityAliases;
  c.assertArray(aliases, "unit.identityAliases");
  aliases.forEach((a, i) => c.assertNamespacedId(a, `unit.identityAliases[${i}]`));
  c.assertUnique(aliases, (a) => a, "unit.identityAliases");
  if (aliases.includes(input.id)) c.fail("unit.identityAliases no puede incluir el id actual");

  return c.deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    root: input.root,
    kind: input.kind,
    profiles,
    owns: [...input.owns],
    excludes: [...excludes],
    dependsOn: [...dependsOn],
    identityAliases: [...aliases],
    provenance: c.createProvenance(input.provenance, "unit.provenance"),
  });
}

module.exports = { SCHEMA_VERSION, UNIT_KINDS, createUnit };
