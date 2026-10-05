"use strict";

/**
 * Resolución de la configuración engineering efectiva con procedencia por
 * hoja (T03). Pasos, en orden y sin defaults ocultos:
 *
 *   1. leer y validar `kiritek-engineering.config.json` (schema + secretos);
 *   2. parsear flags/env allowlisted;
 *   3. fijar la versión de catálogo (flag > env > repo) y resolver UNA snapshot;
 *   4. validar la config contra el catálogo y el repo;
 *   5. admitir la política organizacional sólo si está verificada;
 *   6. aplicar precedencia por unidad/control y validar parámetros finales;
 *   7. calcular `configHash` reproducible.
 *
 * No lee `kiritek-security.config.json` ni variables de security.
 */

const { createUnit } = require("../contracts/unit.js");
const { createProfile } = require("../contracts/profile.js");
const { deepFreeze, PACK_ID } = require("../contracts/common.js");
const { hashJson } = require("../canonical.js");
const { raise } = require("../errors.js");
const { createCatalogSession } = require("../catalog/resolve.js");
const defaults = require("./defaults.js");
const { loadConfigFile } = require("./load.js");
const {
  assertNoSecrets,
  validateConfigSchema,
  validateOrganizationSchema,
  validateConfigSemantics,
  controlFrom,
  assertLevelSupported,
  assertParameterKeys,
  assertParametersValid,
} = require("./validate.js");
const { parseFlags, parseEnv, levelOverride, resolveControlLayers } = require("./precedence.js");
const { ProvenanceRecorder, pointer, fileRef, redactUrl, provenanceReport } = require("./provenance.js");

/**
 * Vista que entra en `configHash`: sólo lo que puede cambiar una decisión
 * (catálogo, organización, unidades/perfiles, niveles/parámetros, excepciones,
 * plugins, presupuestos y modo offline). Recursos de la máquina (procesos,
 * memoria), rutas de cache/evidencia y telemetría quedan fuera para que la
 * misma revisión+config+catálogo produzca el mismo hash en cualquier host.
 */
function hashableView(effective) {
  return {
    pack: effective.pack,
    organization: effective.organization,
    workspace: effective.workspace,
    defaults: effective.defaults,
    units: effective.units,
    exceptions: effective.exceptions,
    plugins: effective.plugins,
    execution: { budgetsMs: effective.execution.budgetsMs, offline: effective.execution.offline },
  };
}

function catalogRef(snapshot, ...segments) {
  return `catalog:${snapshot.ref.id}@${snapshot.ref.version}#${pointer(...segments)}`;
}

/** Política organizacional: participa sólo si su origen/clave fueron verificados. */
function admitOrganization(document, organizationPolicy, diagnostics) {
  const decl = document.organization;
  if (!decl) {
    if (organizationPolicy) diagnostics.push({ code: "ORG_POLICY_IGNORED", message: "hay política organizacional pero la config no declara organization" });
    return null;
  }
  const verified =
    !!organizationPolicy &&
    organizationPolicy.verified === true &&
    organizationPolicy.source === decl.source &&
    organizationPolicy.keyId === decl.trustKeyId;
  if (!verified) {
    if (decl.required) {
      raise("CONFIG_ORG_UNVERIFIED", `la política organizacional requerida (${redactUrl(decl.source)}) no está disponible o no fue verificada`, {
        pointer: `${defaults.CONFIG_FILE}#/organization`,
        remediation: "Obtenga la política firmada con la clave declarada; no se continúa sin ella.",
      });
    }
    diagnostics.push({ code: "ORG_POLICY_UNVERIFIED", message: "política organizacional no verificada: no participa en la precedencia" });
    return { declared: true, participating: false, source: redactUrl(decl.source), keyId: decl.trustKeyId, document: null };
  }
  validateOrganizationSchema(organizationPolicy.document);
  assertNoSecrets(organizationPolicy.document, "organization");
  return { declared: true, participating: true, source: redactUrl(decl.source), keyId: decl.trustKeyId, document: organizationPolicy.document };
}

function resolveScalar(recorder, ptr, layers) {
  let value;
  for (const layer of layers) {
    if (layer.value === undefined) continue;
    value = layer.value;
    recorder.clearUnder(ptr);
    recorder.recordTree(ptr, value, { sourceKind: layer.kind, sourceRef: layer.ref, ...(layer.version ? { sourceVersion: layer.version } : {}) });
  }
  return value;
}

/** Resuelve un bloque global (execution/evidence/...) default ← repo por hoja. */
function resolveBlock(recorder, name, base, repoBlock, extraLayers = {}) {
  const out = {};
  for (const key of Object.keys(base)) {
    const layers = [
      { kind: "catalog", ref: `kiritek-init:defaults#${pointer(name, key)}`, value: base[key] },
      { kind: "repo", ref: fileRef(defaults.CONFIG_FILE, name, key), value: repoBlock ? repoBlock[key] : undefined },
      ...(extraLayers[key] || []),
    ];
    if (key === "budgetsMs") {
      out[key] = {};
      for (const m of Object.keys(base.budgetsMs)) {
        out[key][m] = resolveScalar(recorder, pointer(name, key, m), [
          { kind: "catalog", ref: `kiritek-init:defaults#${pointer(name, key, m)}`, value: base.budgetsMs[m] },
          { kind: "repo", ref: fileRef(defaults.CONFIG_FILE, name, key, m), value: repoBlock && repoBlock.budgetsMs ? repoBlock.budgetsMs[m] : undefined },
        ]);
      }
    } else {
      out[key] = resolveScalar(recorder, pointer(name, key), layers);
    }
  }
  return out;
}

/**
 * @param {object} input
 * @param {string} [input.repoRoot]         Raíz del repo (para leer config y confinar rutas).
 * @param {object} [input.document]         Config ya parseada (alternativa a leer de disco).
 * @param {object} [input.flags]            Flags CLI ya parseados (allowlist).
 * @param {object} [input.env]              Entorno (default process.env).
 * @param {{document, verified, source, keyId}} [input.organizationPolicy]
 * @param {object} [input.catalogOptions]   Opciones de `resolveCatalog` (roots, cacheRoot, runtime...).
 * @param {object} [input.catalogSession]   Sesión de catálogo de la ejecución.
 * @param {number} [input.cpuCount]
 */
function resolveEngineeringConfig(input = {}) {
  const diagnostics = [];
  const sourceRef = defaults.CONFIG_FILE;

  let document = input.document;
  if (document === undefined) {
    const loaded = loadConfigFile(input.repoRoot);
    if (!loaded.present) {
      raise("CONFIG_NOT_FOUND", `${sourceRef} no existe: el pack engineering/guardrails no está configurado`, {
        remediation: "Ejecute 'kiritek-init guardrails install' o cree la config desde la plantilla.",
      });
    }
    document = loaded.document;
  }
  validateConfigSchema(document, sourceRef);
  assertNoSecrets(document, sourceRef);

  const flags = parseFlags(input.flags || {});
  const env = parseEnv(input.env || process.env);

  const recorder = new ProvenanceRecorder();
  const catalogVersion = resolveScalar(recorder, pointer("pack", "catalog"), [
    { kind: "repo", ref: fileRef(sourceRef, "pack", "catalog"), value: document.pack.catalog },
    { kind: "env", ref: "env:KIRITEK_ENGINEERING_CATALOG", value: env.catalog },
    { kind: "flag", ref: "flag:--catalog", value: flags.catalog },
  ]);
  // El digest fijado en la config sólo aplica a la versión que fija la config.
  const expectedDigest = catalogVersion === document.pack.catalog ? document.pack.catalogDigest : undefined;
  const session = input.catalogSession || createCatalogSession(input.catalogOptions || {});
  const snapshot = session.resolve(catalogVersion, expectedDigest ? { expectedDigest } : {});
  const { catalog, parameterSchemas } = snapshot;

  const warnings = validateConfigSemantics(document, snapshot, { repoRoot: input.repoRoot, sourceRef });
  warnings.forEach((w) => diagnostics.push({ code: "CONFIG_WARNING", message: w }));

  const org = admitOrganization(document, input.organizationPolicy, diagnostics);
  const orgControls = org && org.participating ? org.document.controls : {};
  for (const [id, setting] of Object.entries(orgControls)) {
    const where = `organization#${pointer("controls", id)}`;
    const ctl = controlFrom(catalog, id, where);
    assertLevelSupported(ctl, setting.level, `${where}/level`);
    assertParameterKeys(ctl, parameterSchemas[id], setting.parameters, `${where}/parameters`);
  }

  for (const lv of [...(env.levels || []), ...(flags.levels || [])]) {
    const ctl = controlFrom(catalog, lv.controlId, `override ${lv.controlId}`);
    assertLevelSupported(ctl, lv.level, `override ${lv.controlId}`);
    if (lv.unitId && !document.workspace.units.some((u) => u.id === lv.unitId)) {
      raise("CONFIG_UNKNOWN_UNIT", `override de nivel para unidad no declarada "${lv.unitId}"`, { remediation: "Use un id de unidad declarado." });
    }
  }

  const repoControls = (document.defaults && document.defaults.controls) || {};
  const resolveControl = (ctl, unitId, unitIndex, unitControls, basePtr) => {
    const layers = [
      { kind: "catalog", ref: catalogRef(snapshot, "controls", ctl.id, "defaults"), version: catalog.version, setting: ctl.defaults },
      orgControls[ctl.id] && {
        kind: "organization",
        ref: `organization#${pointer("controls", ctl.id)}`,
        version: org.keyId,
        setting: orgControls[ctl.id],
        locked: orgControls[ctl.id].locked === true,
      },
      repoControls[ctl.id] && { kind: "repo", ref: fileRef(sourceRef, "defaults", "controls", ctl.id), setting: repoControls[ctl.id] },
      unitControls && unitControls[ctl.id] && {
        kind: "unit",
        ref: fileRef(sourceRef, "workspace", "units", unitIndex, "controls", ctl.id),
        setting: unitControls[ctl.id],
      },
      levelOverride(env.levels, ctl.id, unitId) && { kind: "env", ref: "env:KIRITEK_ENGINEERING_LEVELS", setting: { level: levelOverride(env.levels, ctl.id, unitId) } },
      levelOverride(flags.levels, ctl.id, unitId) && { kind: "flag", ref: "flag:--level", setting: { level: levelOverride(flags.levels, ctl.id, unitId) } },
    ].filter(Boolean);
    const resolved = resolveControlLayers({ basePtr, layers, recorder });
    assertParametersValid(ctl, parameterSchemas[ctl.id], resolved.parameters, `${basePtr}/parameters`);
    return resolved;
  };

  const repoLevelControls = {};
  for (const ctl of catalog.controls) {
    repoLevelControls[ctl.id] = resolveControl(ctl, null, null, null, pointer("defaults", "controls", ctl.id));
  }

  const ws = document.workspace;
  const workspace = {
    inheritProfiles: resolveScalar(recorder, pointer("workspace", "inheritProfiles"), [
      { kind: "catalog", ref: "kiritek-init:defaults#/workspace/inheritProfiles", value: defaults.WORKSPACE_DEFAULTS.inheritProfiles },
      { kind: "repo", ref: fileRef(sourceRef, "workspace", "inheritProfiles"), value: ws.inheritProfiles },
    ]),
    sharedPaths: resolveScalar(recorder, pointer("workspace", "sharedPaths"), [
      { kind: "catalog", ref: "kiritek-init:defaults#/workspace/sharedPaths", value: defaults.WORKSPACE_DEFAULTS.sharedPaths },
      { kind: "repo", ref: fileRef(sourceRef, "workspace", "sharedPaths"), value: ws.sharedPaths },
    ]),
    onAmbiguousImpact: resolveScalar(recorder, pointer("workspace", "onAmbiguousImpact"), [
      { kind: "catalog", ref: "kiritek-init:defaults#/workspace/onAmbiguousImpact", value: defaults.WORKSPACE_DEFAULTS.onAmbiguousImpact },
      { kind: "repo", ref: fileRef(sourceRef, "workspace", "onAmbiguousImpact"), value: ws.onAmbiguousImpact },
    ]),
  };

  const catalogRefObj = { ...snapshot.ref };
  const profileFromDecl = (decl, sourceKind, ref, source) =>
    createProfile({
      id: decl.id,
      version: decl.version,
      catalog: catalogRefObj,
      extends: catalog.profiles.find((p) => p.id === decl.id).extends,
      parameters: decl.parameters || {},
      source,
      provenance: { sourceKind, sourceRef: ref },
    });

  const units = ws.units
    .map((u, i) => {
      const unitPtr = pointer("units", u.id);
      const profiles = u.profiles.map((p, j) => profileFromDecl(p, "unit", fileRef(sourceRef, "workspace", "units", i, "profiles", j), "explicit"));
      const inherit = u.inheritProfiles !== undefined ? u.inheritProfiles : workspace.inheritProfiles;
      if (inherit) {
        (ws.profiles || []).forEach((p, j) => {
          const dup = profiles.find((x) => x.id === p.id);
          if (dup && dup.version !== p.version) {
            raise("CONFIG_AMBIGUOUS", `unidad ${u.id}: perfil ${p.id} con versiones distintas en unidad y repositorio`, {
              pointer: fileRef(sourceRef, "workspace", "units", i, "profiles"),
            });
          }
          if (!dup) profiles.push(profileFromDecl(p, "inherited", fileRef(sourceRef, "workspace", "profiles", j), "inherited"));
        });
      }
      profiles.forEach((p) => recorder.record(`${unitPtr}/profiles/${p.id}@${p.version}`, p.source, p.provenance));

      const unit = createUnit({
        id: u.id,
        root: u.root,
        kind: u.kind,
        profiles,
        owns: u.owns,
        excludes: u.excludes || [],
        dependsOn: u.dependsOn || [],
        identityAliases: u.identityAliases || [],
        provenance: { sourceKind: "unit", sourceRef: fileRef(sourceRef, "workspace", "units", i) },
      });
      const controls = {};
      for (const ctl of catalog.controls) {
        controls[ctl.id] = resolveControl(ctl, u.id, i, u.controls, `${unitPtr}/controls/${pointer(ctl.id).slice(1)}`);
      }
      return { unit, controls };
    })
    .sort((a, b) => (a.unit.id < b.unit.id ? -1 : a.unit.id > b.unit.id ? 1 : 0));

  const offlineLayers = {
    offline: [
      { kind: "env", ref: "env:KIRITEK_ENGINEERING_OFFLINE", value: env.offline },
      { kind: "flag", ref: "flag:--offline", value: flags.offline },
    ],
  };
  const effective = {
    schemaVersion: 1,
    pack: { id: PACK_ID, catalog: catalogRefObj },
    organization: org ? { participating: org.participating, source: org.source, keyId: org.keyId } : null,
    workspace,
    defaults: { controls: repoLevelControls },
    units,
    execution: resolveBlock(recorder, "execution", defaults.executionDefaults(input.cpuCount), document.execution, offlineLayers),
    evidence: resolveBlock(recorder, "evidence", defaults.EVIDENCE_DEFAULTS, document.evidence),
    exceptions: resolveBlock(recorder, "exceptions", defaults.EXCEPTIONS_DEFAULTS, document.exceptions),
    telemetry: resolveBlock(recorder, "telemetry", defaults.TELEMETRY_DEFAULTS, document.telemetry),
    plugins: (document.plugins || []).map((p) => ({ ...p })),
  };
  const serializable = JSON.parse(JSON.stringify(effective));

  return deepFreeze({
    catalog: catalogRefObj,
    effective: serializable,
    configHash: hashJson(hashableView(serializable)),
    provenance: recorder.toJSON(),
    diagnostics,
  });
}

/** Nivel efectivo de un control para una unidad (o del repo si unitId es null). */
function levelFor(resolved, unitId, controlId) {
  const entry = unitId === null ? resolved.effective.defaults : resolved.effective.units.find((u) => u.unit.id === unitId);
  if (!entry) raise("CONFIG_UNKNOWN_UNIT", `unidad no declarada "${unitId}"`);
  const ctl = entry.controls[controlId];
  if (!ctl) raise("CONFIG_UNKNOWN_CONTROL", `control desconocido "${controlId}"`);
  return ctl.level;
}

module.exports = { resolveEngineeringConfig, levelFor, provenanceReport, hashableView };
