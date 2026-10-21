"use strict";

/**
 * Comprobaciones profundas y reutilizables de la auditoría por capacidades
 * (Tarea 28). Este módulo NO decide la forma final del objeto `capability`
 * (eso vive en `capabilities.js`); aquí viven las piezas verificables que esas
 * capas usan:
 *
 *  - Compatibilidad/enlace REAL de los adaptadores Claude/Kiro: no basta con
 *    que el shim exista; se confirma que el formato de hook es el soportado y
 *    que las políticas relevantes (matchers de escritura/comando) están
 *    realmente enlazadas. (14.4)
 *  - Jira configurado/verificable: habilitado + baseUrl + presencia de
 *    credencial en el entorno — SIN imprimir jamás el valor. (14.5, 13.8)
 *  - Aplicabilidad Flutter vía `detect.js` (no por existencia de archivos del
 *    pack). (28.1, 12.5)
 *  - Observación remota con estados explícitos derivados de un PROBE real
 *    (nunca inferidos de archivos locales): observed | unauthorized |
 *    not-configured | not-applicable | unknown. (14.5, 17.7, 25.4)
 *  - Freshness/última ejecución/commit+config hash/enforcement efectivo a
 *    partir de evidencia vigente (nunca `verified` sin evidencia). (11, 14.1)
 *  - Drift de rama default y excepciones activas. (8.5, 19.6)
 *  - Self-checks sintéticos seguros bajo `--deep`, con limpieza y redacción
 *    garantizadas: un secreto sintético (canario) que el gate DEBE atrapar,
 *    confirmando que el control dispara; luego se limpia y nunca se filtra.
 *
 * Nada aquí abre red por sí mismo: el `transport`/probe es inyectable, igual
 * que en `integrations/jira.js`. En producción el CLI inyecta un transporte
 * real; en pruebas se usa un mock. Honestidad por defecto: cuando algo no se
 * puede verificar, se devuelve `unknown` con una razón.
 *
 * (Requisitos 8.5, 11, 14.1–14.9, 17.7, 19.6, 25.4, 26.1, G.11–G.12.)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const engine = require("../policy/engine.js");
const { redact, findCanaries } = require("../scanners/redactor.js");
const { supportsVerification } = require("../domain/evidence.js");
const { detectStacks } = require("../detect.js");
const kiroAdapter = require("../integrations/kiro.js");
const jira = require("../integrations/jira.js");
const defaultBranchMod = require("../git/default-branch.js");

/** Estados de observación remota (28.2). */
const OBSERVATION = Object.freeze({
  OBSERVED: "observed",
  UNAUTHORIZED: "unauthorized",
  NOT_CONFIGURED: "not-configured",
  NOT_APPLICABLE: "not-applicable",
  UNKNOWN: "unknown",
});

/** Un canario sintético reservado para los self-checks `--deep`.
 * NO es una credencial real: es un patrón que el detector reconoce para
 * confirmar que el control dispara y que la redacción lo atrapa. Nunca debe
 * aparecer en ninguna salida. */
const SYNTHETIC_CANARY = "AKIAZZSELFCHECK0CANARY"; // forma AKIA + 16 chars

/**
 * ¿El proyecto es Flutter? Se decide por `detect.js` (pubspec), no por la
 * existencia de archivos del pack. (28.1, 12.5)
 */
function isFlutterProject(repoRoot) {
  try {
    return detectStacks(repoRoot).includes("flutter");
  } catch (_) {
    return false;
  }
}

/**
 * Verifica el ENLACE real del adaptador Claude: no basta con el shim; las
 * políticas relevantes (matchers de escritura y comando) deben estar presentes
 * en `.claude/settings.json`. Devuelve banderas verificables; `capabilities.js`
 * las combina en la capa.
 *
 * @returns {{ settingsPresent, writeLinked, commandLinked, mcpDeclared,
 *   formatSupported, linked }}
 */
function claudeLinkage(repoRoot) {
  const settings = path.join(repoRoot, ".claude", "settings.json");
  const out = {
    settingsPresent: false,
    writeLinked: false,
    commandLinked: false,
    mcpDeclared: false,
    formatSupported: false,
    linked: false,
  };
  if (!fs.existsSync(settings)) return out;
  out.settingsPresent = true;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(settings, "utf8"));
  } catch (_) {
    return out; // settings presente pero no parseable → sin enlace verificable
  }
  const pre =
    parsed && parsed.hooks && Array.isArray(parsed.hooks.PreToolUse)
      ? parsed.hooks.PreToolUse
      : null;
  // El formato soportado es un array `hooks.PreToolUse`; si no existe, el
  // formato no es el que este adaptador sabe enlazar.
  if (!pre) return out;
  out.formatSupported = true;
  const matchers = pre
    .map((e) => (e && typeof e.matcher === "string" ? e.matcher : null))
    .filter(Boolean);
  out.writeLinked = matchers.some((m) => /Edit|Write/.test(m));
  out.commandLinked = matchers.some((m) => /Bash/.test(m));
  out.mcpDeclared = matchers.some((m) => m.includes("mcp__"));
  out.linked = out.writeLinked && out.commandLinked;
  return out;
}

/**
 * Verifica el ENLACE real del adaptador Kiro: los hooks `.kiro/hooks/*.json`
 * deben ser del formato soportado (`version: v1`), propiedad de Kiritek (su
 * acción `command` invoca el shim) y con matchers de escritura y comando.
 * (14.4, 25.5)
 *
 * @returns {{ hooksDirPresent, formatSupported, writeLinked, commandLinked,
 *   kiritekOwned, linked }}
 */
function kiroLinkage(repoRoot) {
  const hooksDir = path.join(repoRoot, ".kiro", "hooks");
  const out = {
    hooksDirPresent: false,
    formatSupported: false,
    writeLinked: false,
    commandLinked: false,
    kiritekOwned: false,
    linked: false,
  };
  if (!fs.existsSync(hooksDir)) return out;
  out.hooksDirPresent = true;
  let entries = [];
  try {
    entries = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".json"));
  } catch (_) {
    return out;
  }
  for (const name of entries) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(hooksDir, name), "utf8"));
    } catch (_) {
      continue;
    }
    if (!parsed || parsed.version !== kiroAdapter.HOOK_FORMAT_VERSION) continue;
    const defs = Array.isArray(parsed.hooks) ? parsed.hooks : [];
    for (const h of defs) {
      const cmd =
        h && h.action && typeof h.action.command === "string" ? h.action.command : "";
      const isKiritek = /\.kiritek\/adapters\/kiro\/pretooluse\.sh/.test(cmd);
      if (!isKiritek) continue;
      if (h.trigger !== kiroAdapter.HOOK_EVENT) continue;
      out.kiritekOwned = true;
      out.formatSupported = true;
      const matcher = typeof h.matcher === "string" ? h.matcher : "";
      if (/fs_write|write|str_replace/.test(matcher)) out.writeLinked = true;
      if (/execute_bash|shell|use_aws/.test(matcher)) out.commandLinked = true;
    }
  }
  out.linked = out.kiritekOwned && out.writeLinked && out.commandLinked;
  return out;
}

/**
 * Resuelve el estado "configurado/verificable" de Jira desde la config efectiva
 * y el entorno. NUNCA imprime ni devuelve el valor de la credencial: sólo si
 * está PRESENTE. (14.5, 13.8)
 *
 * @returns {{ enabled, baseUrl, credentialsPresent, configured, verifiable,
 *   requireCredentials }}
 */
function jiraConfiguration(config, env) {
  const policy = jira.resolveRemotePolicy(config || {});
  const creds = jira.resolveCredentials(env || {});
  const configured = policy.enabled && !!policy.baseUrl;
  // Verificable = configurado + credencial presente (o no obligatoria). La
  // verificación REAL (observación) la hace `probeJira`, no esta función.
  const verifiable = configured && (creds.present || !policy.requireCredentials);
  return {
    enabled: policy.enabled,
    baseUrl: policy.baseUrl,
    credentialsPresent: creds.present,
    configured,
    verifiable,
    requireCredentials: policy.requireCredentials,
  };
}

/**
 * Mapea el outcome normalizado de un probe Jira al estado de OBSERVACIÓN
 * remota. Deriva de un ATTEMPT real (transporte), no de archivos locales.
 *
 * @param {string} outcome  jira.OUTCOME
 * @returns {string} OBSERVATION
 */
function observationFromOutcome(outcome) {
  if (outcome === jira.OUTCOME.UNAUTHORIZED) return OBSERVATION.UNAUTHORIZED;
  if (jira.POSITIVE_OUTCOMES.includes(outcome)) return OBSERVATION.OBSERVED;
  if (outcome === jira.OUTCOME.DOES_NOT_EXIST || outcome === jira.OUTCOME.INVALID_POLICY) {
    // El tenant respondió (fue accesible), aunque la clave sonda no exista.
    return OBSERVATION.OBSERVED;
  }
  // timeout/error/rate-limited: no se pudo observar de forma concluyente.
  return OBSERVATION.UNKNOWN;
}

/**
 * Observa remotamente la disponibilidad del tenant Jira mediante un probe
 * inyectable. No infiere nada de archivos locales: si no hay transporte o Jira
 * no está configurado, el estado es `not-configured`/`unknown`, nunca
 * `observed`. (14.5, 17.7, 25.4)
 *
 * El `probe` es la MISMA interfaz que `jira.createRestTransport()` devuelve:
 * `async ({ baseUrl, key, credentials, transport }) => { status, ... }`.
 *
 * @param {object} args { config, env, probe, probeKey }
 * @returns {Promise<{ observation, reason }>}
 */
async function probeJira(args) {
  const cfg = jiraConfiguration(args.config, args.env);
  if (!cfg.enabled) {
    return { observation: OBSERVATION.NOT_CONFIGURED, reason: "Jira deshabilitado" };
  }
  if (!cfg.baseUrl) {
    return { observation: OBSERVATION.NOT_CONFIGURED, reason: "Jira sin baseUrl/tenant" };
  }
  const probe = args.probe;
  if (typeof probe !== "function") {
    // Sin transporte no podemos observar; honestamente desconocido.
    return { observation: OBSERVATION.UNKNOWN, reason: "sin transporte para observar Jira" };
  }
  const creds = jira.resolveCredentials(args.env || {});
  if (cfg.requireCredentials && !creds.present) {
    // No se intenta el probe sin credenciales obligatorias; no es "observado".
    return {
      observation: OBSERVATION.UNAUTHORIZED,
      reason: "credenciales Jira obligatorias ausentes (no se imprime el valor)",
    };
  }
  // Una clave sonda neutra. El resultado nos dice si el tenant es accesible,
  // no la existencia de un ticket real.
  const probeKey = typeof args.probeKey === "string" && args.probeKey ? args.probeKey : "PROBE-0";
  let resp;
  try {
    resp = await probe({
      baseUrl: cfg.baseUrl,
      key: probeKey,
      credentials: creds,
      transport: "rest",
    });
  } catch (_) {
    return { observation: OBSERVATION.UNKNOWN, reason: "probe Jira falló (red/timeout)" };
  }
  const outcome = jira.normalizeOutcome(resp);
  const observation = observationFromOutcome(outcome);
  const reason =
    observation === OBSERVATION.OBSERVED
      ? "tenant Jira accesible (observado remotamente)"
      : observation === OBSERVATION.UNAUTHORIZED
      ? "tenant Jira no autorizado (401/403)"
      : "resultado remoto Jira no concluyente";
  return { observation, reason };
}

/**
 * Detecta drift de la rama default: compara la rama resuelta/configurada contra
 * la cabeza remota observable. Si no hay repo Git o no se puede resolver, es
 * `unknown`, nunca drift falso. (8.5)
 *
 * @returns {{ applicable, drift, configured, observed, reason }}
 */
function defaultBranchDrift(repoRoot, config) {
  const isGit = fs.existsSync(path.join(repoRoot, ".git"));
  if (!isGit) {
    return { applicable: false, drift: false, configured: null, observed: null, reason: "no es repo Git" };
  }
  const db = (config && config.defaultBranch) || {};
  const remote = db.remote || "origin";
  const explicit = db.explicit || db.cached || null;
  let resolved;
  try {
    resolved = defaultBranchMod.resolveDefaultBranch({ repoRoot, remote, explicit });
  } catch (_) {
    resolved = { branch: null };
  }
  // La "configurada/cache local" es la explícita si existe; si no, la resuelta.
  const configured = explicit || resolved.branch || null;
  let driftInfo;
  try {
    driftInfo = defaultBranchMod.detectDrift(repoRoot, remote, configured);
  } catch (_) {
    driftInfo = { drift: false, current: null, cachedBranch: configured };
  }
  if (!driftInfo.current || !configured) {
    return {
      applicable: true,
      drift: false,
      configured,
      observed: driftInfo.current || null,
      reason: "no se pudo observar la cabeza remota para comparar drift",
    };
  }
  return {
    applicable: true,
    drift: !!driftInfo.drift,
    configured,
    observed: driftInfo.current,
    reason: driftInfo.drift
      ? `rama default remota (${driftInfo.current}) difiere de la configurada (${configured})`
      : null,
  };
}

/**
 * Cuenta excepciones activas (no expiradas) desde un archivo de excepciones
 * administrado. No lee contenido sensible: sólo cuenta y clasifica por estado.
 * Si no hay archivo, devuelve 0 activas. (reporta cantidad/edad/owner/estado
 * sin contenido — aquí sólo cantidad activa, 19.6/28.3)
 *
 * @returns {{ total, active, expired }}
 */
function activeExceptions(repoRoot, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const file = path.join(repoRoot, ".kiritek", "exceptions.json");
  if (!fs.existsSync(file)) return { total: 0, active: 0, expired: 0 };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return { total: 0, active: 0, expired: 0 };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  let active = 0;
  let expired = 0;
  for (const exc of list) {
    const exp = exc && exc.expiresAt ? Date.parse(exc.expiresAt) : NaN;
    if (!Number.isNaN(exp) && exp <= now) expired += 1;
    else active += 1;
  }
  return { total: list.length, active, expired };
}

/**
 * Evalúa la FRESCURA de una evidencia para una capa: ¿sostiene una afirmación
 * verificada para el commit/alcance/edad dados? Devuelve datos verificables.
 * (11, 14.1 — nunca `verified` sin evidencia vigente del mismo commit.)
 *
 * @param {object|null} evidence
 * @param {object} expectation { commit?, scope?, maxAgeHours? }
 * @param {object} deps { now }
 * @returns {{ present, fresh, lastRun, lastResult, commit, configHash, reason }}
 */
function evidenceFreshness(evidence, expectation = {}, deps = {}) {
  if (!evidence || typeof evidence !== "object") {
    return {
      present: false,
      fresh: null,
      lastRun: null,
      lastResult: "unknown",
      commit: null,
      configHash: null,
      reason: "sin evidencia de ejecución",
    };
  }
  const check = supportsVerification(evidence, expectation, deps);
  return {
    present: true,
    fresh: check.ok,
    lastRun: typeof evidence.createdAt === "string" ? evidence.createdAt : null,
    lastResult: typeof evidence.decision === "string" ? evidence.decision : "unknown",
    commit: typeof evidence.commit === "string" ? evidence.commit : null,
    configHash: typeof evidence.configHash === "string" ? evidence.configHash : null,
    reason: check.ok ? null : check.reason,
  };
}

/**
 * Ejecuta un self-check sintético seguro: materializa un secreto SINTÉTICO
 * (canario) en un `.env` dentro de un temporal AISLADO, lo pasa por el motor en
 * modo enforce y confirma que:
 *   1. el control DISPARA (deny), y
 *   2. la salida NO filtra el canario (redacción efectiva).
 *
 * Garantías:
 *  - El canario nunca sale de este módulo: el resultado sólo reporta banderas.
 *  - El temporal se elimina SIEMPRE en `finally` (cleanup garantizado).
 *  - Es inyectable: `deps.evaluate` permite sustituir el motor en pruebas sin
 *    tocar el disco; `deps.tmpBase` fija el directorio base del temporal.
 *
 * @param {object} [deps] { evaluate, tmpBase }
 * @returns {{ ran, fired, leaked, reason }}
 */
function runSyntheticSelfCheck(deps = {}) {
  const evaluate =
    typeof deps.evaluate === "function"
      ? deps.evaluate
      : (files) => engine.evaluateFiles({ event: "self-check", mode: "enforce", files }, {});

  const tmpBase = deps.tmpBase || os.tmpdir();
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(tmpBase, "kiritek-selfcheck-"));
    const envFile = path.join(dir, ".env");
    // El contenido lleva un canario sintético con forma de credencial real.
    const content = `# synthetic self-check — do not use\nAWS_SECRET=${SYNTHETIC_CANARY}\n`;
    fs.writeFileSync(envFile, content, { mode: 0o600 });

    // El motor opera sobre ruta+contenido (no re-lee el disco), pero escribimos
    // el archivo para ejercitar un flujo realista con cleanup garantizado.
    const policyResult = evaluate([{ path: ".env", content }]);
    const fired = policyResult && (policyResult.decision === "deny" || policyResult.decision === "error");

    // Verificación de no filtración: redactamos el resultado y buscamos el
    // canario tanto por su forma como literalmente.
    const serialized = JSON.stringify(redact(policyResult));
    const leaked =
      findCanaries(serialized).length > 0 || serialized.includes(SYNTHETIC_CANARY);

    return {
      ran: true,
      fired: !!fired,
      leaked,
      reason: !fired
        ? "el control sintético NO disparó (el gate no bloqueó el canario)"
        : leaked
        ? "el canario sintético se filtró en la salida (fallo de redacción)"
        : null,
    };
  } catch (err) {
    return { ran: false, fired: false, leaked: false, reason: `self-check falló: ${err.message}` };
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {
        /* best-effort: nunca dejamos el canario, pero no reventamos el audit */
      }
    }
  }
}

module.exports = {
  OBSERVATION,
  SYNTHETIC_CANARY,
  isFlutterProject,
  claudeLinkage,
  kiroLinkage,
  jiraConfiguration,
  observationFromOutcome,
  probeJira,
  defaultBranchDrift,
  activeExceptions,
  evidenceFreshness,
  runSyntheticSelfCheck,
};
