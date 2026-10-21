"use strict";

/**
 * Catalog: snapshot inmutable, versionado y direccionado por digest (R4).
 * Sólo se modela la forma del contrato; la resolución/verificación de digest
 * y la carga desde disco viven en `../catalog/**` (T02).
 */

const c = require("./common.js");
const { createControlDefinition } = require("./control.js");

const SCHEMA_VERSION = 1;
const KEYS = ["schemaVersion", "id", "version", "digest", "signature", "compatibility", "profiles", "controls", "migrations", "publishedAt"];

function profileDefinition(input, i) {
  const label = `catalog.profiles[${i}]`;
  c.assertObject(input, label);
  c.assertKnownKeys(input, ["id", "version", "extends", "parametersSchemaRef", "description"], label);
  c.assertProfileId(input.id, `${label}.id`);
  c.assertSemver(input.version, `${label}.version`);
  c.assertString(input.description, `${label}.description`);
  const ext = input.extends === undefined ? [] : input.extends;
  c.assertArray(ext, `${label}.extends`);
  const out = {
    id: input.id,
    version: input.version,
    description: input.description,
    extends: ext.map((r, j) => c.createProfileRef(r, `${label}.extends[${j}]`)),
  };
  if (input.parametersSchemaRef !== undefined) {
    c.assertRef(input.parametersSchemaRef, `${label}.parametersSchemaRef`);
    out.parametersSchemaRef = input.parametersSchemaRef;
  }
  return out;
}

function compatibility(input) {
  c.assertObject(input, "catalog.compatibility");
  c.assertKnownKeys(input, ["node", "kiritekInit", "platforms"], "catalog.compatibility");
  c.assertString(input.node, "catalog.compatibility.node");
  c.assertString(input.kiritekInit, "catalog.compatibility.kiritekInit");
  c.assertArray(input.platforms, "catalog.compatibility.platforms");
  if (input.platforms.length === 0) c.fail("catalog.compatibility.platforms no puede estar vacío");
  input.platforms.forEach((p, i) => c.assertEnum(p, ["darwin", "linux", "win32"], `catalog.compatibility.platforms[${i}]`));
  return { node: input.node, kiritekInit: input.kiritekInit, platforms: [...input.platforms] };
}

function createCatalog(input) {
  c.assertObject(input, "catalog");
  c.assertKnownKeys(input, KEYS, "catalog");
  if (input.schemaVersion !== undefined && input.schemaVersion !== SCHEMA_VERSION) {
    c.fail(`catalog.schemaVersion debe ser ${SCHEMA_VERSION}`, "INVALID_VERSION");
  }
  if (input.id !== c.PACK_ID) c.fail(`catalog.id debe ser "${c.PACK_ID}"`);
  c.assertSemver(input.version, "catalog.version");
  c.assertSha256(input.digest, "catalog.digest");
  c.assertIso(input.publishedAt, "catalog.publishedAt");

  c.assertArray(input.profiles, "catalog.profiles");
  const profiles = input.profiles.map(profileDefinition);
  c.assertUnique(profiles, (p) => p.id, "catalog.profiles");
  const profileIds = new Set(profiles.map((p) => p.id));
  for (const p of profiles) {
    for (const base of p.extends) {
      if (!profileIds.has(base.id)) c.fail(`catalog: perfil ${p.id} extiende '${base.id}' no definido`, "UNKNOWN_REFERENCE");
    }
  }

  c.assertArray(input.controls, "catalog.controls");
  const controls = input.controls.map((ctl) => createControlDefinition(ctl));
  c.assertUnique(controls, (ctl) => ctl.id, "catalog.controls");
  for (const ctl of controls) {
    for (const p of [...(ctl.profiles.allOf || []), ...(ctl.profiles.anyOf || [])]) {
      if (!profileIds.has(p)) c.fail(`catalog: control ${ctl.id} requiere perfil '${p}' no definido`, "UNKNOWN_REFERENCE");
    }
  }

  const migrations = input.migrations === undefined ? [] : input.migrations;
  c.assertArray(migrations, "catalog.migrations");
  const migrationsOut = migrations.map((m, i) => {
    const label = `catalog.migrations[${i}]`;
    c.assertObject(m, label);
    c.assertKnownKeys(m, ["from", "to", "ref"], label);
    c.assertSemver(m.from, `${label}.from`);
    c.assertSemver(m.to, `${label}.to`);
    c.assertRef(m.ref, `${label}.ref`);
    return { from: m.from, to: m.to, ref: m.ref };
  });

  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    version: input.version,
    digest: input.digest,
    compatibility: compatibility(input.compatibility),
    profiles,
    controls,
    migrations: migrationsOut,
    publishedAt: input.publishedAt,
  };
  if (input.signature !== undefined) {
    c.assertObject(input.signature, "catalog.signature");
    c.assertKnownKeys(input.signature, ["keyId", "algorithm", "signatureRef"], "catalog.signature");
    c.assertString(input.signature.keyId, "catalog.signature.keyId");
    c.assertEnum(input.signature.algorithm, ["ed25519", "ecdsa-p256-sha256"], "catalog.signature.algorithm");
    c.assertRef(input.signature.signatureRef, "catalog.signature.signatureRef");
    catalog.signature = { ...input.signature };
  }
  return c.deepFreeze(catalog);
}

function catalogRefOf(catalog) {
  return { id: catalog.id, version: catalog.version, digest: catalog.digest };
}

module.exports = { SCHEMA_VERSION, createCatalog, catalogRefOf };
