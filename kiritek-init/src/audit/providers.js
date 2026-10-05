"use strict";

/**
 * Auditoría de PROVIDERS y protección de sus artefactos críticos (Tarea 41).
 *
 * Audita cada pack de provider (GitHub, AWS CodeCommit) de forma INDEPENDIENTE
 * y honesta, reutilizando el vocabulario de capacidades (`audit/checks.js`
 * OBSERVATION + `capabilities.capability()`), los generadores de plan dry-run
 * (`providers/*`) y la protección por ownership de `policy/exceptions.js`. No
 * reimplementa nada de eso.
 *
 * Invariantes que este módulo garantiza por diseño:
 *
 *  41.1 LOCAL present vs REMOTO observado — para CADA pack por separado:
 *       - LOCAL = el pack está disponible (generador registrado) y sus
 *         plantillas/plan existen en el repo. NUNCA se infiere cumplimiento
 *         remoto por la presencia local (17.7).
 *       - REMOTO = estado de OBSERVACIÓN derivado de un probe INYECTABLE
 *         (observed | unauthorized | not-configured | unknown). Sin transporte,
 *         por defecto NO se abre red → unknown (hay credencial) o
 *         not-configured (no hay credencial).
 *       - Un pack NO seleccionado/aplicable ⇒ `not-applicable`.
 *
 *  41.2 DRIFT de rulesets/IAM/workflows/pins/owners SIN auto-corregir cloud:
 *       drift = el estado remoto OBSERVADO difiere del artefacto PLANIFICADO
 *       (deseado). Se REPORTA; jamás se corrige. El plan sigue siendo dry-run.
 *
 *  41.3 Capacidades dependientes de PLAN/LICENCIA/PERMISOS y su FALLBACK:
 *       - GitHub secret scanning / push protection dependen de plan/permisos:
 *         si no están disponibles se marcan `unavailable` y el core Gitleaks
 *         sigue siendo el gate (nunca se reemplaza).
 *       - Rulesets vs branch-protection: se marca cuál es el PREFERIDO y cuál
 *         el FALLBACK equivalente.
 *       - Protección de cambios críticos por un OWNER DISTINTO cuando sea
 *         posible: se reutiliza `exceptions.assessRemoteOwnership`
 *         (CODEOWNERS / fuente de ownership). Si no hay fuente, se declara la
 *         limitación con honestidad en vez de fingir protección.
 *
 *  Aislamiento (16.8/17.1): auditar un pack NO acopla ni instala/activa al
 *  otro ni al core. Cada pack se audita por separado; auditarlos juntos sólo
 *  compone sus resultados, nunca cruza su estado.
 *
 *  Cero red por defecto / redacción (26.9): el probe es inyectable; las
 *  credenciales se leen SÓLO del entorno (presencia) y jamás se imprimen.
 *
 * (Requisitos 14.5, 16, 17, 24.6, 27.3–27.6, 28.2, G.9–G.11.)
 */

const fs = require("fs");
const path = require("path");

const providersRegistry = require("./../providers/index.js");
const base = require("./../providers/base.js");
const exceptions = require("../policy/exceptions.js");
const checks = require("./checks.js");

/**
 * Metadatos por pack: cómo se detecta su presencia LOCAL (plantillas) y qué
 * artefactos críticos protege. NO acopla los packs entre sí: es sólo una tabla
 * de rutas por nombre.
 */
const PACK_META = Object.freeze({
  github: Object.freeze({
    // Artefactos locales que, si están presentes, indican el pack instalado.
    templateDir: ["templates", "providers", "github"],
    criticalArtifacts: Object.freeze([
      "ruleset.json",
      "branch-protection.json",
      "CODEOWNERS",
      path.join("workflows", "kiritek-security.yml"),
    ]),
    // El recurso cuya observación define el estado global del plan.
    primaryResource: "branch-protection",
    // Capacidades dependientes de plan/licencia/permisos y su fallback (41.3).
    capabilityGates: Object.freeze([
      Object.freeze({
        id: "ruleset",
        dependsOn: "permissions",
        fallback: "branch-protection",
        note: "ruleset es el PREFERIDO; branch protection es el FALLBACK equivalente si la org/repo no soporta rulesets",
      }),
      Object.freeze({
        id: "secret-scanning",
        dependsOn: "plan",
        fallback: "gitleaks-core",
        note: "GitHub secret scanning depende del plan/permisos; si no está disponible, el gate del core (Gitleaks) sigue cubriendo el control (nunca se reemplaza)",
      }),
      Object.freeze({
        id: "push-protection",
        dependsOn: "plan",
        fallback: "gitleaks-core",
        note: "push protection depende del plan/permisos; complementa a Gitleaks, nunca lo reemplaza",
      }),
    ]),
  }),
  "aws-codecommit": Object.freeze({
    templateDir: ["templates", "providers", "aws-codecommit"],
    criticalArtifacts: Object.freeze([
      "iam-least-privilege.yaml",
      "approval-rule-template.json",
      "codepipeline.yaml",
      "sns-eventbridge.yaml",
      "LIMITATIONS.md",
    ]),
    primaryResource: "iam-policies",
    capabilityGates: Object.freeze([
      Object.freeze({
        id: "approval-rule-self-approval-prevention",
        dependsOn: "permissions",
        fallback: "iam-role-pool",
        note: "CodeCommit no excluye nativamente al autor del conteo de aprobadores; la prevención de autoaprobación se refuerza con un pool de aprobadores por rol IAM distinto",
      }),
      Object.freeze({
        id: "iam-least-privilege",
        dependsOn: "permissions",
        fallback: null,
        note: "el despliegue del IAM de mínimo privilegio requiere permisos de administración de IAM acotados; sin ellos, el pack sólo describe el plan (dry-run)",
      }),
    ]),
  }),
});

/** Nombre de recurso → id del cambio planificado que lo describe. */
const RESOURCE_TO_CHANGE = Object.freeze({
  github: Object.freeze({
    "branch-protection": "branch-protection-fallback",
    ruleset: "ruleset-default-branch",
    "secret-scanning": "secret-scanning",
    "push-protection": "push-protection",
    workflow: "workflow-security",
    codeowners: "codeowners",
  }),
  "aws-codecommit": Object.freeze({
    "iam-policies": "iam-least-privilege-default-branch",
    "approval-rule-template": "approval-rule-default-branch",
    codepipeline: "pipeline-core-gates",
    notifications: "notifications-sns-eventbridge",
  }),
});

/**
 * ¿La presencia LOCAL del pack está instalada en el repo? Se decide por la
 * existencia de al menos un artefacto crítico del pack bajo el repo (instalado)
 * o bajo las plantillas del paquete (disponible para generar). NO infiere nada
 * remoto. (41.1)
 *
 * @returns {{ present, source, artifacts: string[] }}
 */
function detectLocalPresence(repoRoot, packName) {
  const meta = PACK_META[packName];
  if (!meta) return { present: false, source: null, artifacts: [] };

  // Ubicaciones donde pueden vivir los artefactos del pack: instalado bajo
  // `.kiritek/providers/<pack>/` o disponible como plantilla del paquete.
  const roots = [
    { source: "installed", dir: path.join(repoRoot, ".kiritek", "providers", packName) },
    { source: "templates", dir: path.join(repoRoot, ...meta.templateDir) },
  ];

  for (const root of roots) {
    const found = [];
    for (const rel of meta.criticalArtifacts) {
      const p = path.join(root.dir, rel);
      try {
        if (fs.existsSync(p)) found.push(rel);
      } catch (_) {
        /* ignora y sigue */
      }
    }
    if (found.length > 0) {
      return { present: true, source: root.source, artifacts: found };
    }
  }
  return { present: false, source: null, artifacts: [] };
}

/**
 * Genera el plan DESEADO (dry-run) del pack con el transporte de observación
 * inyectado (por defecto, sin red). Devuelve el plan completo y schema-válido.
 *
 * @param {string} packName
 * @param {object} input { env, config, observe }
 * @param {object} deps  { clock, idGenerator }
 */
function buildDesiredPlan(packName, input, deps) {
  return providersRegistry.createPlan(packName, input, deps);
}

/**
 * Deriva el estado de OBSERVACIÓN de un recurso concreto desde el plan. El plan
 * ya clasificó la observación por recurso en sus `requiredPermissions`/`changes`
 * (status de permiso = observación del recurso principal). Para recursos
 * secundarios usamos el `action` del cambio planificado como señal (noop ⇒
 * observado-activo). Si el pack no observó, el estado es unknown/not-configured.
 *
 * Devuelve el OBSERVATION global del plan (recurso principal) más el detalle.
 */
function observationFromPlan(plan) {
  // El plan expone `observation` global (del recurso principal) directamente.
  return plan.observation;
}

/**
 * Detecta DRIFT comparando el estado remoto OBSERVADO contra el artefacto
 * PLANIFICADO (deseado). Drift = hay observación concluyente (observed) pero el
 * recurso remoto NO coincide con lo planificado. El pack señala esto cuando el
 * `action` del cambio es `create`/`update` AUNQUE el recurso haya sido
 * observado como existente, o cuando el transporte reporta `drift:true`.
 *
 * NUNCA corrige: sólo reporta. (41.2)
 *
 * El `driftProbe` es inyectable y devuelve, por recurso:
 *   { observed: boolean, matchesPlan: boolean, reason?: string }
 * Sin probe, el drift es `unknown` (no se puede comparar sin observar), nunca
 * un falso positivo.
 *
 * @param {string} packName
 * @param {object} plan   plan deseado
 * @param {function} [driftProbe]  ({ resource, plan }) => { observed, matchesPlan, reason? }
 * @returns {{ checked, drift, details: object[], reason }}
 */
function detectDrift(packName, plan, driftProbe) {
  const meta = PACK_META[packName];
  const resources = Object.keys(RESOURCE_TO_CHANGE[packName] || {});
  if (typeof driftProbe !== "function") {
    return {
      checked: false,
      drift: false,
      details: [],
      reason:
        "sin transporte de observación de drift: no se compara el estado remoto con el plan (no se asume drift)",
    };
  }

  const details = [];
  let anyDrift = false;
  for (const resource of resources) {
    const changeId = RESOURCE_TO_CHANGE[packName][resource];
    const planned = (plan.changes || []).find((c) => c.id === changeId) || null;
    let result;
    try {
      result = driftProbe({ resource, plan, planned });
    } catch (err) {
      details.push({
        resource,
        observed: false,
        matchesPlan: null,
        drift: false,
        reason: `observación de drift falló: ${err.code || "error"}`,
      });
      continue;
    }
    if (!result || typeof result !== "object" || result.observed !== true) {
      // No observado concluyentemente ⇒ no se puede afirmar drift (ni ausencia).
      details.push({
        resource,
        observed: false,
        matchesPlan: null,
        drift: false,
        reason: (result && result.reason) || "recurso no observado remotamente de forma concluyente",
      });
      continue;
    }
    const matches = result.matchesPlan === true;
    const drifted = !matches;
    if (drifted) anyDrift = true;
    details.push({
      resource,
      observed: true,
      matchesPlan: matches,
      drift: drifted,
      reason: drifted
        ? (result.reason ||
            `el estado remoto de '${resource}' difiere del artefacto planificado (reportado, NO corregido)`)
        : null,
    });
  }

  void meta;
  return {
    checked: true,
    drift: anyDrift,
    details,
    reason: anyDrift
      ? "se detectó drift entre el estado remoto observado y el plan; se REPORTA sin auto-corregir cloud (dry-run)"
      : "sin drift observado: el estado remoto coincide con el plan donde fue observable",
  };
}

/**
 * Construye las "capacidades dependientes de plan/licencia/permisos y su
 * fallback" para un pack, enriquecidas con la observación del plan. (41.3)
 *
 * Cada entrada: { id, dependsOn, fallback, available, note } donde `available`
 * refleja lo OBSERVADO (nunca se afirma disponible sin observación). Para
 * GitHub secret scanning/push protection, `available` sólo es true si el plan
 * observó el recurso como existente (action noop); de lo contrario `unknown`.
 */
function capabilityGates(packName, plan) {
  const meta = PACK_META[packName];
  const gates = meta ? meta.capabilityGates : [];
  return gates.map((g) => {
    // Disponibilidad OBSERVADA desde el plan: un cambio `noop` indica que el
    // recurso ya existe/está activo remotamente (observado); cualquier otro
    // estado NO afirma disponibilidad.
    const changeId = (RESOURCE_TO_CHANGE[packName] || {})[g.id];
    const change = changeId ? (plan.changes || []).find((c) => c.id === changeId) : null;
    let available;
    if (!change) {
      available = "unknown";
    } else if (change.action === "noop") {
      available = true;
    } else {
      // create/update propuesto ⇒ no está activo (o no se observó): honesto.
      available =
        plan.observation === base.OBSERVATION.OBSERVED ? false : "unknown";
    }
    return {
      id: g.id,
      dependsOn: g.dependsOn,
      fallback: g.fallback,
      available,
      note: g.note,
    };
  });
}

/**
 * Evalúa la protección por OWNER DISTINTO de los artefactos críticos del pack.
 * Reutiliza `exceptions.assessRemoteOwnership` (CODEOWNERS / fuente de
 * ownership). Si no hay fuente, declara la limitación con honestidad. (41.3,
 * 17.6)
 *
 * @returns {{ supported, protected, source, reason }}
 */
function ownershipProtection(repoRoot, deps = {}) {
  return exceptions.assessRemoteOwnership({
    repoRoot,
    fs: deps.fs,
    path: deps.path,
  });
}

/**
 * ¿El pack está SELECCIONADO/es aplicable? La selección es EXPLÍCITA: viene de
 * la lista `selected` (p. ej. del flag `--provider` o de la config). Un pack no
 * seleccionado es `not-applicable`, nunca "fallido". (41.1)
 *
 * Acepta string ("github"), array (["github","aws-codecommit"]) o undefined.
 */
function isSelected(packName, selected) {
  if (selected === undefined || selected === null) return false;
  if (typeof selected === "string") return selected === packName;
  if (Array.isArray(selected)) return selected.includes(packName);
  return false;
}

/**
 * Audita UN pack de provider y devuelve una capacidad (`capability()` shape vía
 * el helper inyectado) con el detalle de providers añadido. NUNCA observa por sí
 * misma: delega en los probes inyectados. (41.1–41.3)
 *
 * @param {string} packName
 * @param {object} args {
 *   repoRoot, env, config, selected, observe, driftProbe, clock, idGenerator,
 *   capabilityFactory  // = capabilities.capability
 * }
 */
function auditProvider(packName, args = {}) {
  const capability = args.capabilityFactory;
  if (typeof capability !== "function") {
    throw new TypeError("auditProvider requiere args.capabilityFactory (capabilities.capability)");
  }
  const id = `provider-${packName}`;
  const supported = providersRegistry.SUPPORTED.includes(packName);

  // Pack desconocido: no aplicable con razón honesta.
  if (!supported) {
    return capability(id, false, {
      observation: checks.OBSERVATION.NOT_APPLICABLE,
      reason: `provider desconocido: ${packName}`,
    });
  }

  const selected = isSelected(packName, args.selected);
  const local = detectLocalPresence(args.repoRoot || process.cwd(), packName);

  // No seleccionado ⇒ not-applicable (aunque las plantillas existan). (41.1)
  if (!selected) {
    return capability(id, false, {
      installed: local.present,
      observation: checks.OBSERVATION.NOT_APPLICABLE,
      reason: local.present
        ? `pack '${packName}' presente localmente pero NO seleccionado/configurado: no aplicable (local≠remoto)`
        : `pack '${packName}' no seleccionado/configurado: no aplicable`,
      provider: {
        pack: packName,
        selected: false,
        localPresent: local.present,
        localSource: local.source,
      },
    });
  }

  // Seleccionado: construimos el plan deseado (dry-run) con el transporte de
  // observación inyectado (por defecto, sin red).
  const deps = {
    clock: typeof args.clock === "function" ? args.clock : () => "1970-01-01T00:00:00.000Z",
    idGenerator:
      typeof args.idGenerator === "function" ? args.idGenerator : () => `audit-plan-${packName}`,
  };
  let plan;
  try {
    plan = buildDesiredPlan(
      packName,
      { env: args.env || {}, config: args.config || {}, observe: args.observe },
      deps
    );
  } catch (err) {
    return capability(id, false, {
      installed: local.present,
      observation: checks.OBSERVATION.UNKNOWN,
      reason: `no se pudo construir el plan deseado del pack: ${err.code || err.message}`,
      provider: { pack: packName, selected: true, localPresent: local.present },
    });
  }

  const observation = observationFromPlan(plan);
  const drift = detectDrift(packName, plan, args.driftProbe);
  const gates = capabilityGates(packName, plan);
  const ownership = ownershipProtection(args.repoRoot || process.cwd(), {
    fs: args.fs,
    path: args.path,
  });

  // ── Mapea OBSERVATION del plan al vocabulario de auditoría (idéntico set,
  //    salvo que el plan nunca emite `not-applicable`). ────────────────────────
  const auditObservation = observation; // observed|unauthorized|not-configured|unknown

  // El `active` sólo es true si el recurso principal fue observado remotamente.
  const active = auditObservation === checks.OBSERVATION.OBSERVED && !drift.drift;

  // Razón honesta compuesta.
  const reasonParts = [];
  reasonParts.push(
    local.present
      ? `local presente (${local.source}: ${local.artifacts.length} artefacto(s) crítico(s))`
      : "sin artefactos locales del pack (plan generable, pero nada instalado)"
  );
  reasonParts.push(`remoto=${auditObservation}: ${plan.observationReason}`);
  if (drift.checked) reasonParts.push(drift.reason);
  if (!ownership.protected) {
    reasonParts.push(`protección por owner distinto: ${ownership.reason}`);
  }

  return capability(id, true, {
    installed: local.present,
    active,
    observation: auditObservation,
    drift: drift.drift,
    reason: reasonParts.join("; "),
    provider: {
      pack: packName,
      selected: true,
      localPresent: local.present,
      localSource: local.source,
      localArtifacts: local.artifacts,
      planId: plan.planId,
      dryRun: plan.dryRun,
      applied: plan.applied,
      observation: auditObservation,
      observationReason: plan.observationReason,
      requiredPermissions: plan.requiredPermissions.map((p) => ({
        id: p.id,
        scope: p.scope,
        status: p.status,
      })),
      capabilityGates: gates,
      drift: {
        checked: drift.checked,
        drift: drift.drift,
        details: drift.details,
        reason: drift.reason,
      },
      ownership: {
        supported: ownership.supported,
        protected: ownership.protected,
        source: ownership.source,
        reason: ownership.reason,
      },
    },
  });
}

/**
 * Audita TODOS los packs soportados. Cada pack se audita por SEPARADO; auditar
 * juntos sólo COMPONE sus resultados (nunca cruza su estado): el aislamiento se
 * preserva porque `auditProvider` sólo toca el pack indicado. (41.4)
 *
 * @param {object} args  igual que `auditProvider`, menos `packName`:
 *   { repoRoot, env, config, selected, observe, driftProbe, clock,
 *     idGenerator, capabilityFactory, perPack }
 *   - `observe`/`driftProbe` pueden ser una función (misma para todos) o un
 *     objeto por pack: { github, "aws-codecommit" }.
 *   - `selected` controla qué packs son aplicables.
 * @returns {object[]} capacidades (una por pack soportado)
 */
function auditAllProviders(args = {}) {
  const resolvePerPack = (value, packName) => {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value !== "function") {
      return value[packName];
    }
    return value;
  };
  return providersRegistry.SUPPORTED.map((packName) =>
    auditProvider(packName, {
      ...args,
      observe: resolvePerPack(args.observe, packName),
      driftProbe: resolvePerPack(args.driftProbe, packName),
    })
  );
}

module.exports = {
  PACK_META,
  RESOURCE_TO_CHANGE,
  detectLocalPresence,
  buildDesiredPlan,
  observationFromPlan,
  detectDrift,
  capabilityGates,
  ownershipProtection,
  isSelected,
  auditProvider,
  auditAllProviders,
};
