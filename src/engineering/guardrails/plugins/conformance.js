"use strict";

/**
 * Conformidad de los controles/perfiles de un plugin (T15B.1, T15B.3, R23).
 *
 * - Cada control pasa por el MISMO contrato que los builtin
 *   (`createControlDefinition`), con id, collectors, normalizer,
 *   applicability y evaluator bajo el namespace del plugin.
 * - Presupuestos por momento dentro de los límites del pack; schema de
 *   parámetros presente y verificado (checksum del plugin).
 * - `enforce` sólo con contrato de enforcement y suite de conformidad
 *   APROBADA localmente; si no, el nivel se retira (la config que lo pida
 *   falla) y queda un diagnóstico — nunca se degrada en silencio.
 * - Datos sensibles: categorías personales/contenido de usuario exigen
 *   finalidad y consentimiento; credenciales nunca.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createControlDefinition } = require("../contracts/control.js");
const { MOMENT_BUDGET_LIMITS_MS } = require("../catalog/conformance.js");
const { raise } = require("../errors.js");
const { assertPluginPermissions } = require("./permissions.js");

const CONSENT_CATEGORIES = ["personal-data", "user-content", "telemetry"];

function underNamespace(id, ns) {
  return id.startsWith(`${ns}/`);
}

/**
 * @returns {{controls: object[], profiles: object[], parameterSchemas: Record<string, object>, diagnostics: object[]}}
 */
function conformPlugin({ manifest, absRoot, approvedConformanceSuites = [] }) {
  const ns = manifest.namespace;
  const diagnostics = [];
  const approved = new Set(approvedConformanceSuites);
  const profiles = manifest.profiles.map((p) => {
    if (!underNamespace(p.id, ns)) raise("PLUGIN_NAMESPACE_INVALID", `${manifest.id}: perfil ${p.id} fuera del namespace ${ns}`);
    return { id: p.id, version: p.version, description: p.description, extends: [...p.extends] };
  });
  const parameterSchemas = {};
  const controls = manifest.controls.map((raw, i) => {
    let def;
    try {
      def = createControlDefinition(JSON.parse(JSON.stringify(raw)));
    } catch (err) {
      raise("PLUGIN_CONTROL_INVALID", `${manifest.id}: controls[${i}] inválido (${err.code || "CONTRACT_INVALID"}): ${err.message}`);
    }
    const refs = [def.id, ...def.collectors, def.normalizer, def.applicability, def.evaluator].filter(Boolean);
    const outside = refs.filter((r) => !underNamespace(r, ns));
    if (outside.length) raise("PLUGIN_NAMESPACE_INVALID", `${manifest.id}: ${outside.join(", ")} fuera del namespace ${ns}`);
    for (const m of def.moments) {
      if (m.budgetMs > MOMENT_BUDGET_LIMITS_MS[m.moment]) raise("PLUGIN_CONTROL_INVALID", `${def.id}: presupuesto de ${m.moment} (${m.budgetMs}ms) excede ${MOMENT_BUDGET_LIMITS_MS[m.moment]}ms`);
    }
    assertPluginPermissions(def, manifest.id);
    const schemaRel = def.parametersSchemaRef;
    if (!schemaRel || !manifest.files[schemaRel]) raise("PLUGIN_CONTROL_INVALID", `${def.id}: schema de parámetros ausente o no verificado`);
    parameterSchemas[def.id] = JSON.parse(fs.readFileSync(path.join(absRoot, ...schemaRel.split("/")), "utf8"));
    if (def.enforcementContract) {
      const suite = `${def.enforcementContract.conformanceSuite}@${def.enforcementContract.approvedVersion}`;
      if (!approved.has(suite)) {
        diagnostics.push({ code: "PLUGIN_ENFORCE_NOT_APPROVED", message: `${def.id}: suite ${suite} no aprobada; 'enforce' no disponible (sólo warn)` });
        const { enforcementContract, ...rest } = def; // eslint-disable-line no-unused-vars
        return { ...rest, supportedLevels: def.supportedLevels.filter((l) => l !== "enforce") };
      }
    }
    return def;
  });
  const ids = new Set(controls.map((c) => c.id));
  for (const req of manifest.dataRequests || []) {
    if (!ids.has(req.controlId)) raise("PLUGIN_MANIFEST_INVALID", `${manifest.id}: dataRequests para control desconocido ${req.controlId}`);
    if (req.categories.includes("credentials")) raise("PLUGIN_DATA_CONSENT_REQUIRED", `${req.controlId}: un plugin no puede solicitar credenciales`);
    if (req.categories.some((c) => CONSENT_CATEGORIES.includes(c)) && !req.consentRef) {
      raise("PLUGIN_DATA_CONSENT_REQUIRED", `${req.controlId}: ${req.categories.join(", ")} requiere consentimiento registrado (consentRef) y finalidad`);
    }
  }
  return { controls, profiles, parameterSchemas, diagnostics };
}

module.exports = { conformPlugin };
