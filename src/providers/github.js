"use strict";

/**
 * Generador del plan del provider GitHub ENDURECIDO (tarea 39).
 *
 * Un plan de GitHub es un ARTEFACTO DESCRITO (dry-run): enumera los cambios que
 * un operador aplicaría para endurecer el repo (rulesets o branch protection
 * equivalente, Actions por SHA, CODEOWNERS, secret scanning/push protection) y
 * los permisos que harían falta, PERO nunca muta estado remoto ni abre red por
 * su cuenta. Cualquier aplicación requiere confirmación humana EXPLÍCITA fuera
 * de este plan (contrato base, 16.1/17.1/22.6/G.9).
 *
 * Invariantes que este módulo garantiza por diseño:
 *  - Aislamiento de packs (16.8/17.1): NO importa a codecommit ni al instalador
 *    del core. Un pack no instala al otro ni al core.
 *  - Cero red por defecto (17.7): la observación remota se delega a un
 *    transporte INYECTABLE. Sin transporte, `generate` no abre red: el estado
 *    honesto es `unknown` (hay credencial, pero no se observó) o
 *    `not-configured` (no hay credencial). Nunca `observed` sin observación.
 *  - Determinismo (22.6): mismo input → mismo partial (byte-idéntico). El reloj
 *    y el id los añade el contrato base; este módulo no usa `Date`/`random`.
 *  - Redacción (26.9): las credenciales se leen SÓLO del entorno y jamás se
 *    imprimen; sólo se reporta su PRESENCIA.
 *  - Nunca reemplaza Gitleaks (17.5): secret scanning/push protection se
 *    reportan como complemento; si no están disponibles, se dice honestamente
 *    `unavailable`/`unknown`, el core Gitleaks sigue siendo el gate.
 *  - No afirma éxito (17.7): diferencia `unauthorized` (403, permiso denegado)
 *    de `not-configured` (sin credencial) y ofrece COMANDOS/diff que el
 *    operador correría, sin ejecutarlos.
 */

const base = require("./base.js");

const PROVIDER = "github";

/** Rama default por defecto cuando la config no la fija explícitamente. */
const DEFAULT_BRANCH_FALLBACK = "main";

/** Revisiones mínimas por defecto exigidas en la rama protegida (17.3). */
const DEFAULT_REQUIRED_REVIEWS = 1;

/**
 * Rutas que CODEOWNERS/los revisores deben proteger (17.6). Describe el alcance;
 * la plantilla CODEOWNERS del pack concreta los propietarios.
 */
const PROTECTED_PATHS = Object.freeze([
  ".kiritek/",
  "kiritek-security.config.json",
  "templates/core/security/",
  ".github/workflows/",
  ".kiritek/hooks/",
  ".gitleaksignore",
  "CODEOWNERS",
]);

/**
 * ¿Hay una credencial de GitHub PRESENTE en el entorno? Sólo se reporta la
 * PRESENCIA; el valor jamás se lee para imprimirlo. (26.9 / redacción)
 */
function hasCredential(env = {}) {
  return (
    (typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN.trim() !== "") ||
    (typeof env.GH_TOKEN === "string" && env.GH_TOKEN.trim() !== "")
  );
}

/** Resuelve la rama default desde la config (explícita) o el fallback seguro. */
function resolveDefaultBranch(config = {}) {
  const db = config && config.defaultBranch;
  if (db && typeof db.explicit === "string" && db.explicit.trim() !== "") {
    return db.explicit.trim();
  }
  return DEFAULT_BRANCH_FALLBACK;
}

/** Resuelve el número de revisiones requeridas desde la config (o el default). */
function resolveRequiredReviews(config = {}) {
  const gh = config && config.github;
  if (gh && Number.isInteger(gh.requiredReviews) && gh.requiredReviews >= 0) {
    return gh.requiredReviews;
  }
  return DEFAULT_REQUIRED_REVIEWS;
}

/**
 * Transporte de observación por defecto: NO abre red. Devuelve un resultado
 * `unknown` honesto, reportando que no hay transporte para observar. Los tests
 * inyectan un transporte sintético (mocks 200/403/404) sin tocar la red real.
 *
 * Un transporte real (fuera de este plan) recibiría `{ env, config, resource }`
 * y devolvería `{ status, httpStatus?, reason? }`.
 */
function noNetworkTransport() {
  return { status: base.OBSERVATION.UNKNOWN, reason: "sin transporte de observación: no se abre red" };
}

/**
 * Normaliza el resultado de una observación a un estado del contrato base.
 * Diferencia explícitamente:
 *   - 401/403 → unauthorized (credencial presente pero acceso denegado)
 *   - 404     → not-configured (el recurso no existe/no está configurado)
 *   - 200     → observed
 *   - resto   → unknown
 */
function classifyObservation(result, credentialPresent) {
  if (!result || typeof result !== "object") {
    return { status: credentialPresent ? base.OBSERVATION.UNKNOWN : base.OBSERVATION.NOT_CONFIGURED };
  }
  // `enabled` (si el transporte lo reporta) se preserva para distinguir un
  // recurso observado-activo de uno observado-disponible-pero-inactivo.
  const enabled = typeof result.enabled === "boolean" ? result.enabled : undefined;
  if (result.status && base.OBSERVATIONS.includes(result.status)) {
    return { status: result.status, httpStatus: result.httpStatus, reason: result.reason, enabled };
  }
  const http = result.httpStatus;
  if (http === 401 || http === 403) {
    return { status: base.OBSERVATION.UNAUTHORIZED, httpStatus: http, reason: result.reason, enabled };
  }
  if (http === 404) {
    return { status: base.OBSERVATION.NOT_CONFIGURED, httpStatus: http, reason: result.reason, enabled };
  }
  if (http === 200) {
    return { status: base.OBSERVATION.OBSERVED, httpStatus: http, reason: result.reason, enabled };
  }
  return { status: base.OBSERVATION.UNKNOWN, httpStatus: http, reason: result.reason, enabled };
}

/**
 * Comandos que el OPERADOR correría para aplicar/observar (nunca los ejecuta el
 * pack). Se incrustan en la descripción de los cambios (17.7: ofrecer
 * comandos/diff sin afirmar éxito). Usan placeholders {owner}/{repo}.
 */
function applyCommands(defaultBranch) {
  return {
    ruleset:
      "gh api --method POST /repos/{owner}/{repo}/rulesets " +
      "--input .kiritek/providers/github/ruleset.json",
    branchProtection:
      `gh api --method PUT /repos/{owner}/{repo}/branches/${defaultBranch}/protection ` +
      "--input .kiritek/providers/github/branch-protection.json",
    secretScanning:
      "gh api --method PATCH /repos/{owner}/{repo} " +
      '-F security_and_analysis[secret_scanning][status]=enabled',
    pushProtection:
      "gh api --method PATCH /repos/{owner}/{repo} " +
      '-F security_and_analysis[secret_scanning_push_protection][status]=enabled',
  };
}

/**
 * Genera la salida parcial para `buildPlan`. Determinista. No abre red salvo
 * que se inyecte un transporte de observación que lo haga (por defecto, no).
 *
 * @param {object} input  { env, config, observe? }
 *   - observe(resource) → { status?|httpStatus?, reason? } : transporte de
 *     observación opcional. Por defecto `noNetworkTransport` (sin red).
 * @returns {object} parcial de plan para base.buildPlan
 */
function generate(input = {}) {
  const env = input.env || {};
  const config = input.config || {};
  const credentialPresent = hasCredential(env);
  const observe = typeof input.observe === "function" ? input.observe : null;

  const defaultBranch = resolveDefaultBranch(config);
  const requiredReviews = resolveRequiredReviews(config);
  const cmds = applyCommands(defaultBranch);

  // ── Observación remota (dry-run). Sin transporte inyectado NO se abre red. ──
  // Para cada recurso, un transporte sintético puede devolver 200/403/404; sin
  // él, el estado honesto depende sólo de la presencia de credencial.
  function observeResource(resource) {
    if (!observe) {
      return classifyObservation(
        credentialPresent
          ? { status: base.OBSERVATION.UNKNOWN, reason: "credencial presente; sin transporte de observación (no se abre red)" }
          : { status: base.OBSERVATION.NOT_CONFIGURED, reason: "sin credencial GitHub en el entorno; nada que observar" },
        credentialPresent
      );
    }
    let raw;
    try {
      raw = observe({ resource, env, config });
    } catch (err) {
      return { status: base.OBSERVATION.UNKNOWN, reason: `observación falló: ${err.code || "error"}` };
    }
    return classifyObservation(raw, credentialPresent);
  }

  const protection = observeResource("branch-protection");
  const secretScanning = observeResource("secret-scanning");
  const pushProtection = observeResource("push-protection");

  // El estado global del plan refleja la observación de la protección de rama,
  // que es el control principal del pack.
  const observation = protection.status;
  const observationReason = buildObservationReason(observation, protection, credentialPresent);

  // Permisos requeridos: su `status` refleja lo observado (unauthorized vs
  // not-configured vs unknown vs observed), nunca se afirma éxito sin observar.
  const permStatus = (obs) => obs.status;
  const requiredPermissions = [
    {
      id: "repo-administration",
      scope: "administration:write",
      status: permStatus(protection),
      reason:
        protection.httpStatus
          ? `observación de protección de rama devolvió HTTP ${protection.httpStatus}`
          : "necesario para planificar rulesets/branch protection; " +
            (credentialPresent ? "no observado (sin transporte)" : "sin credencial para observar"),
    },
    {
      id: "repo-contents",
      scope: "contents:read",
      status: permStatus(protection),
      reason: "necesario para observar CODEOWNERS/workflows en el repo",
    },
    {
      id: "secret-scanning-admin",
      scope: "administration:write (security_and_analysis)",
      status: permStatus(secretScanning),
      reason:
        "necesario para observar/habilitar secret scanning + push protection; " +
        "complementa a Gitleaks, no lo reemplaza (17.5)",
    },
  ];

  // ── Cambios DESCRITOS (nunca aplicados). ────────────────────────────────────
  const changes = buildChanges({
    defaultBranch,
    requiredReviews,
    cmds,
    secretScanning,
    pushProtection,
  });

  const parameters = [
    { name: "credentialPresent", resolved: credentialPresent, source: "env-presence" },
    { name: "defaultBranch", resolved: defaultBranch, source: config.defaultBranch && config.defaultBranch.explicit ? "config" : "default" },
    { name: "requiredReviews", resolved: requiredReviews, source: config.github && Number.isInteger(config.github.requiredReviews) ? "config" : "default" },
    { name: "rulesetPreferred", resolved: true, source: "default" },
  ];

  const rollback = buildRollback({ defaultBranch });

  const reason = buildPlanReason({ observation, credentialPresent, defaultBranch });

  return {
    provider: PROVIDER,
    observation,
    observationReason,
    changes,
    requiredPermissions,
    parameters,
    rollback,
    reason,
  };
}

/** Razón honesta del estado global de observación. */
function buildObservationReason(observation, protection, credentialPresent) {
  switch (observation) {
    case base.OBSERVATION.OBSERVED:
      return "protección de rama observada remotamente (dry-run)";
    case base.OBSERVATION.UNAUTHORIZED:
      return (
        "acceso DENEGADO al observar la protección de rama" +
        (protection.httpStatus ? ` (HTTP ${protection.httpStatus})` : "") +
        ": permiso insuficiente, no es que falte configuración"
      );
    case base.OBSERVATION.NOT_CONFIGURED:
      return credentialPresent
        ? "la protección de rama no existe/no está configurada en el remoto (HTTP 404)"
        : "sin credencial GitHub en el entorno (GITHUB_TOKEN/GH_TOKEN); nada que observar";
    default:
      return credentialPresent
        ? "credencial GitHub presente, pero no se observó remotamente (sin transporte; no se abre red)"
        : "sin credencial GitHub en el entorno; nada que observar";
  }
}

/**
 * Construye los cambios DESCRITOS: ruleset preferido + branch protection
 * equivalente de fallback + workflow endurecido + CODEOWNERS + secret
 * scanning/push protection. Cada descripción incluye el comando que el operador
 * correría (17.7), nunca ejecutado por el pack.
 */
function buildChanges({ defaultBranch, requiredReviews, cmds, secretScanning, pushProtection }) {
  const changes = [];

  // 39.1 — Ruleset PREFERIDO (17.2/17.3): PR, reviews, checks, resolución de
  // conversaciones, sin force-push y sin borrado de rama.
  changes.push({
    id: "ruleset-default-branch",
    kind: "ruleset",
    target: `branch:${defaultBranch}`,
    action: "create",
    description:
      `[PREFERIDO] Ruleset sobre '${defaultBranch}': exige PR, ${requiredReviews} review(s) mínimas, ` +
      "resolución de conversaciones, checks requeridos (Kiritek Security scan), y bloquea " +
      "force-push (non_fast_forward) y borrado de rama (deletion). " +
      `Plantilla: .kiritek/providers/github/ruleset.json. Aplicar (requiere confirmación): ${cmds.ruleset}`,
  });

  // 39.1 — FALLBACK equivalente con branch protection clásica (17.2) cuando los
  // rulesets no están disponibles para la org/repo.
  changes.push({
    id: "branch-protection-fallback",
    kind: "branch-protection",
    target: `branch:${defaultBranch}`,
    action: "create",
    description:
      `[FALLBACK equivalente si NO hay rulesets] Branch protection sobre '${defaultBranch}': PR obligatorio, ` +
      `${requiredReviews} review(s), code owner review, resolución de conversaciones, checks estrictos, ` +
      "allow_force_pushes=false y allow_deletions=false. " +
      `Plantilla: .kiritek/providers/github/branch-protection.json. Aplicar (requiere confirmación): ${cmds.branchProtection}`,
  });

  // 39.2 — Workflow Actions endurecido que INVOCA el core (no re-escanea).
  changes.push({
    id: "workflow-security",
    kind: "workflow",
    target: ".github/workflows/kiritek-security.yml",
    action: "create",
    description:
      "Workflow de CI endurecido: actions fijadas por SHA inmutable, permisos mínimos (contents: read), " +
      "sin commit/push, manejo seguro de forks (pull_request, sin pull_request_target), " +
      "e INVOCA el comando core 'npx kiritek-init scan' (no reimplementa la detección). " +
      "Plantilla: .kiritek/providers/github/workflows/kiritek-security.yml.",
  });

  // 39.3 — CODEOWNERS para políticas/workflows/hooks/allowlists/config.
  changes.push({
    id: "codeowners",
    kind: "codeowners",
    target: "CODEOWNERS",
    action: "create",
    description:
      "CODEOWNERS que exige revisión de propietarios para: " +
      PROTECTED_PATHS.join(", ") +
      ". Debe acompañarse de 'require review from Code Owners' en el ruleset/branch protection. " +
      "Plantilla: .kiritek/providers/github/CODEOWNERS.",
  });

  // 39.4 — Secret scanning / push protection: COMPLEMENTO, nunca reemplazo de
  // Gitleaks (17.5). El estado honesto depende de la observación; si no está
  // disponible, se reporta sin fingir que quedó activado.
  changes.push({
    id: "secret-scanning",
    kind: "other",
    target: "repo:security_and_analysis.secret_scanning",
    action: secretScanningAction(secretScanning),
    description:
      secretScanningDescription(secretScanning) +
      " GitHub secret scanning COMPLEMENTA a Gitleaks (gate del core); nunca lo reemplaza. " +
      `Habilitar (requiere confirmación): ${applyCommands(DEFAULT_BRANCH_FALLBACK).secretScanning}`,
  });
  changes.push({
    id: "push-protection",
    kind: "other",
    target: "repo:security_and_analysis.secret_scanning_push_protection",
    action: secretScanningAction(pushProtection),
    description:
      secretScanningDescription(pushProtection) +
      " Push protection COMPLEMENTA a Gitleaks; el core Gitleaks sigue siendo el gate obligatorio. " +
      `Habilitar (requiere confirmación): ${applyCommands(DEFAULT_BRANCH_FALLBACK).pushProtection}`,
  });

  return changes;
}

/** Acción honesta para secret scanning según la observación. */
function secretScanningAction(obs) {
  // Si está observado como activo no proponemos cambio (noop); en cualquier otro
  // caso proponemos su habilitación (create), sin afirmar que ya está activa.
  if (obs.status === base.OBSERVATION.OBSERVED && obs.enabled === true) return "noop";
  return "create";
}

/** Descripción honesta de disponibilidad de secret scanning (17.5). */
function secretScanningDescription(obs) {
  switch (obs.status) {
    case base.OBSERVATION.OBSERVED:
      return obs.enabled
        ? "Observado ACTIVO en el remoto (dry-run); no se propone cambio."
        : "Observado DISPONIBLE pero NO activo en el remoto; se propone habilitarlo.";
    case base.OBSERVATION.UNAUTHORIZED:
      return "No autorizado para observar/habilitar (permiso denegado); se reporta honestamente, no se afirma éxito.";
    case base.OBSERVATION.NOT_CONFIGURED:
      return "UNAVAILABLE: no configurado/no disponible por plan o permisos; se reporta sin reemplazar Gitleaks.";
    default:
      return "UNAVAILABLE/UNKNOWN: no se pudo observar (sin transporte/no concluyente); se reporta sin afirmar éxito.";
  }
}

/** Pasos de rollback DESCRITOS (texto; nunca ejecutados). */
function buildRollback({ defaultBranch }) {
  return [
    {
      id: "rollback-ruleset",
      description:
        "Si se aplicó un ruleset: borrarlo con 'gh api --method DELETE /repos/{owner}/{repo}/rulesets/{id}' " +
        "(requiere confirmación humana; el plan no aplica ni revierte).",
    },
    {
      id: "rollback-branch-protection",
      description:
        `Si se aplicó branch protection: 'gh api --method DELETE /repos/{owner}/{repo}/branches/${defaultBranch}/protection'.`,
    },
    {
      id: "rollback-workflow",
      description:
        "El workflow y CODEOWNERS son archivos versionados: revertir con un commit/PR normal. " +
        "El pack no empuja ni revierte por su cuenta.",
    },
  ];
}

/** Razón del plan global. */
function buildPlanReason({ observation, credentialPresent, defaultBranch }) {
  return (
    `Plan del pack GitHub endurecido para la rama default '${defaultBranch}': ruleset preferido con ` +
    "branch protection equivalente de fallback, workflow Actions por SHA que invoca el core, CODEOWNERS " +
    "y observación (no habilitación) de secret scanning/push protection. Es un plan dry-run: no muta estado " +
    "remoto ni abre red; estado de observación=" + observation +
    (credentialPresent ? " (credencial presente)" : " (sin credencial)") + "."
  );
}

module.exports = {
  PROVIDER,
  DEFAULT_BRANCH_FALLBACK,
  DEFAULT_REQUIRED_REVIEWS,
  PROTECTED_PATHS,
  generate,
  hasCredential,
  resolveDefaultBranch,
  resolveRequiredReviews,
  classifyObservation,
  noNetworkTransport,
  applyCommands,
};
