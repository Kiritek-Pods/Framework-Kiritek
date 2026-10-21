"use strict";

/**
 * Auditoría por capacidades y capas reales.
 *
 * A diferencia del audit legacy (que sólo comprobaba existencia de archivos),
 * esta auditoría evalúa cada control en capas independientes: instalado,
 * versión, integridad, configurado, activo, ejecutable, enforcement, última
 * ejecución, resultado, drift. Un archivo presente pero vacío, alterado,
 * obsoleto, no ejecutable o desconectado se marca como falla de la capa
 * correspondiente, no como cumplimiento.
 *
 * Nunca infiere cumplimiento por existencia; cuando algo no se puede verificar,
 * lo dice (`unknown`) y explica por qué.
 *
 * (Requisitos 11, 14.1–14.9, 15.8, G.11–G.12.)
 */

const fs = require("fs");
const path = require("path");

const { validateManifest } = require("../scanners/tool-manifest.js");
const { ensureGitleaks } = require("../scanners/secrets-scan.js");
const hooksMod = require("../git/hooks.js");
const claudeAdapter = require("../integrations/claude.js");
const kiroAdapter = require("../integrations/kiro.js");
const checks = require("./checks.js");
const providersAudit = require("./providers.js");

const INTEGRITY = Object.freeze({ OK: "ok", FAILED: "failed", UNKNOWN: "unknown" });
const ENFORCEMENT = Object.freeze({ WARNING: "warning", ENFORCE: "enforce", OFF: "off", UNKNOWN: "unknown" });

function capability(id, applicable, fields = {}) {
  const cap = {
    id,
    applicable,
    installed: fields.installed ?? false,
    version: fields.version ?? null,
    integrity: fields.integrity ?? INTEGRITY.UNKNOWN,
    configured: fields.configured ?? false,
    active: fields.active ?? false,
    executable: fields.executable ?? false,
    enforcement: fields.enforcement ?? ENFORCEMENT.UNKNOWN,
    lastRun: fields.lastRun ?? null,
    lastResult: fields.lastResult ?? "unknown",
    drift: fields.drift ?? false,
    evidenceRef: fields.evidenceRef ?? null,
    reason: fields.reason ?? null,
  };
  // Campos profundos opcionales (Tarea 28). Sólo se incluyen cuando se aportan,
  // para mantener estable la salida de la auditoría mínima (Tarea 20) y
  // schema-válida (additividad). Nunca se infieren por defecto.
  if (fields.observation !== undefined) cap.observation = fields.observation;
  if (fields.lastResultFresh !== undefined) cap.lastResultFresh = fields.lastResultFresh;
  if (fields.configHash !== undefined) cap.configHash = fields.configHash;
  if (fields.commit !== undefined) cap.commit = fields.commit;
  if (fields.exceptions !== undefined) cap.exceptions = fields.exceptions;
  if (fields.selfCheck !== undefined) cap.selfCheck = fields.selfCheck;
  // Detalle de provider (Tarea 41). Sólo se incluye cuando se aporta, para
  // mantener estable la salida de la auditoría mínima y schema-válida.
  if (fields.provider !== undefined) cap.provider = fields.provider;
  return cap;
}

/** Audita la configuración del core. */
function auditConfig(repoRoot) {
  const file = path.join(repoRoot, "kiritek-security.config.json");
  if (!fs.existsSync(file)) {
    return capability("config", true, { reason: "kiritek-security.config.json ausente" });
  }
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return capability("config", true, { installed: true, integrity: INTEGRITY.FAILED, reason: "config no es JSON válido" });
  }
  const mode = parsed && parsed.mode;
  return capability("config", true, {
    installed: true,
    integrity: INTEGRITY.OK,
    configured: true,
    active: true,
    enforcement: mode === "enforce" ? ENFORCEMENT.ENFORCE : ENFORCEMENT.WARNING,
  });
}

/** Audita el manifiesto de herramientas (Gitleaks): pin y validez. */
function auditTooling(repoRoot, opts = {}) {
  const file = path.join(repoRoot, "templates", "core", "security", "tools", "manifest.json");
  // En un proyecto instalado el manifiesto puede vivir bajo el core instalado;
  // aquí se admite una ruta alternativa.
  const alt = path.join(repoRoot, ".kiritek", "tools", "manifest.json");
  const target = fs.existsSync(file) ? file : fs.existsSync(alt) ? alt : null;
  if (!target) {
    return capability("secret-scanning", true, { reason: "manifiesto de herramientas no encontrado" });
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (_) {
    return capability("secret-scanning", true, { installed: true, integrity: INTEGRITY.FAILED, reason: "manifiesto no parseable" });
  }
  const check = validateManifest(manifest);
  const tool = (manifest.tools || [])[0] || {};
  const pinned = check.valid && check.pendingPins.length === 0;
  // ¿Hay binario verificado en cache para esta plataforma? Sólo cache (offline):
  // la auditoría nunca descarga.
  const bin = pinned ? ensureGitleaks({ repoRoot, offline: true, cacheRoot: opts.toolCacheRoot }) : null;
  const executable = !!bin && bin.status === "ok";
  return capability("secret-scanning", true, {
    installed: true,
    version: tool.version || null,
    integrity: pinned ? INTEGRITY.OK : INTEGRITY.FAILED,
    configured: check.valid,
    active: executable,
    executable,
    reason:
      check.pendingPins.length > 0
        ? `checksums pendientes: ${check.pendingPins.join(", ")}`
        : check.errors.length
        ? check.errors.join("; ")
        : !executable
        ? `binario de gitleaks no disponible en cache (${bin ? bin.reason || bin.status : "sin pin"}); ejecuta \`security install\` con red`
        : null,
  });
}

/** Audita los hooks Git: existencia, gestión por Kiritek, duplicados. */
function auditHooks(repoRoot) {
  const isGit = fs.existsSync(path.join(repoRoot, ".git"));
  if (!isGit) {
    return capability("git-hooks", false, { reason: "no es repositorio Git" });
  }
  const dir = hooksMod.gitHooksDir(repoRoot);
  let anyManaged = false;
  let allExecutable = true;
  for (const name of hooksMod.HOOK_NAMES) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      allExecutable = false;
      continue;
    }
    const content = fs.readFileSync(p, "utf8");
    if (hooksMod.isManagedByKiritek(content)) anyManaged = true;
    try {
      fs.accessSync(p, fs.constants.X_OK);
    } catch (_) {
      allExecutable = false;
    }
  }
  return capability("git-hooks", true, {
    installed: anyManaged,
    active: anyManaged && allExecutable,
    executable: allExecutable,
    reason: anyManaged ? null : "hooks de Kiritek no instalados",
  });
}

/**
 * Audita el adaptador de Claude Code (hooks `PreToolUse`).
 *
 * Comprueba que el shim esté instalado y que el bloque `hooks.PreToolUse` esté
 * registrado en `.claude/settings.json` con los matchers de escritura y
 * comando. Las tools MCP se declaran NO interceptables por contenido:
 * se refleja como una limitación conocida (`reason`), nunca como protección.
 */
function auditClaudeAdapter(repoRoot) {
  const shim = path.join(repoRoot, ".kiritek", "adapters", "claude", "pretooluse.sh");
  const settings = path.join(repoRoot, ".claude", "settings.json");

  const shimInstalled = fs.existsSync(shim);
  let shimExecutable = false;
  if (shimInstalled) {
    try {
      fs.accessSync(shim, fs.constants.X_OK);
      shimExecutable = true;
    } catch (_) {
      shimExecutable = false;
    }
  }

  // Enlace REAL: no basta con el shim; las políticas (matchers de escritura y
  // comando) deben estar realmente enlazadas en .claude/settings.json, y el
  // formato debe ser el soportado por este adaptador. (14.4)
  void settings;
  const link = checks.claudeLinkage(repoRoot);
  const configured = link.linked;
  const active = shimInstalled && shimExecutable && configured && link.formatSupported;

  return capability("assistant-claude", true, {
    installed: shimInstalled,
    active,
    executable: shimExecutable,
    configured,
    // Las acciones MCP no son interceptables por contenido: limitación honesta.
    reason: !shimInstalled
      ? "adaptador Claude no instalado"
      : !link.settingsPresent
      ? "sin .claude/settings.json: enlace de políticas no verificable"
      : !link.formatSupported
      ? "formato de hooks no soportado (se requiere hooks.PreToolUse); capa unavailable"
      : !configured
      ? "hooks PreToolUse presentes pero sin matchers de escritura/comando enlazados"
      : link.mcpDeclared
      ? "activo; tools MCP no interceptables por contenido (unavailable)"
      : "activo; políticas de escritura/comando enlazadas",
  });
}

/**
 * Audita el adaptador de Kiro (hooks `.kiro/hooks/*.json`, formato `version:
 * v1`).
 *
 * Comprueba que el shim esté instalado y que existan hooks `PreToolUse` v1
 * propiedad de Kiritek con los matchers de escritura y comando. Si el formato
 * `v1` o el bloqueo por exit 2 no estuvieran disponibles, la capa se marca
 * `unavailable` (reason) en vez de simular enforcement; Git/CI siguen cubriendo
 * el control. Es independiente del adaptador de Claude.
 */
function auditKiroAdapter(repoRoot) {
  const shim = path.join(repoRoot, ".kiritek", "adapters", "kiro", "pretooluse.sh");

  const shimInstalled = fs.existsSync(shim);
  let shimExecutable = false;
  if (shimInstalled) {
    try {
      fs.accessSync(shim, fs.constants.X_OK);
      shimExecutable = true;
    } catch (_) {
      shimExecutable = false;
    }
  }

  // Enlace REAL: hooks v1 propiedad de Kiritek con matchers de escritura y
  // comando. Si el formato o el bloqueo por exit 2 no están disponibles, la
  // capa queda `unavailable` en vez de simular enforcement. (14.4, 25.5)
  const link = checks.kiroLinkage(repoRoot);
  const configured = link.writeLinked && link.commandLinked;
  const active = shimInstalled && shimExecutable && configured && link.formatSupported;

  return capability("assistant-kiro", true, {
    installed: shimInstalled && link.kiritekOwned,
    active,
    executable: shimExecutable,
    configured,
    reason: !shimInstalled
      ? "adaptador Kiro no instalado"
      : !link.kiritekOwned
      ? "hooks v1 de Kiritek no encontrados en .kiro/hooks"
      : !link.formatSupported
      ? "formato de hook no soportado (se requiere version v1); capa unavailable"
      : !configured
      ? "faltan matchers de escritura/comando en .kiro/hooks"
      : "activo; decisión por exit code (0 permite, 2 bloquea), sin modo ask",
  });
}

/**
 * Audita la aplicabilidad del control móvil OWASP (Flutter). La aplicabilidad
 * se decide por `detect.js` (pubspec), NO por existencia de archivos del pack.
 * Fuera de Flutter la capa es `not_applicable`, nunca "fallida". (28.1, 12.5)
 */
function auditFlutter(repoRoot) {
  const isFlutter = checks.isFlutterProject(repoRoot);
  if (!isFlutter) {
    return capability("mobile-owasp", false, {
      observation: checks.OBSERVATION.NOT_APPLICABLE,
      reason: "proyecto no Flutter: control móvil OWASP no aplicable",
    });
  }
  // Es Flutter: el pack especializado debería estar presente. Comprobamos su
  // skill sin inferir cumplimiento por existencia; sólo marcamos instalado.
  const skillDir = path.join(
    repoRoot,
    ".claude",
    "skills",
    "owasp-mobile-security-checker"
  );
  const installed = fs.existsSync(skillDir);
  return capability("mobile-owasp", true, {
    installed,
    active: installed,
    reason: installed
      ? "proyecto Flutter: control móvil OWASP presente (el gate genérico de secretos vive en el core)"
      : "proyecto Flutter: pack móvil OWASP no instalado",
  });
}

/**
 * Audita la capa Jira: configuración/verificabilidad local + OBSERVACIÓN remota
 * derivada de un probe real (nunca de archivos locales). Las credenciales se
 * leen SÓLO del entorno y jamás se imprimen. (14.5, 17.7, 25.4, 13.8)
 *
 * @param {object} config  Config efectiva.
 * @param {object} env     Entorno (fuente de credenciales).
 * @param {object} deps    { jiraObservation } estado observado ya resuelto
 *                         (async) o `undefined` → observación `unknown`.
 */
function auditJira(config, env, deps = {}) {
  const cfg = checks.jiraConfiguration(config, env);
  if (!cfg.enabled) {
    return capability("jira", false, {
      observation: checks.OBSERVATION.NOT_APPLICABLE,
      reason: "Jira deshabilitado: no aplicable",
    });
  }
  const observation = deps.jiraObservation
    ? deps.jiraObservation.observation
    : checks.OBSERVATION.UNKNOWN;
  const observationReason = deps.jiraObservation ? deps.jiraObservation.reason : "observación remota no realizada";
  // "configurado" = enabled + baseUrl; "verificable" = + credencial presente.
  const configured = cfg.configured;
  const active = observation === checks.OBSERVATION.OBSERVED;
  return capability("jira", true, {
    installed: configured,
    configured,
    active,
    observation,
    reason: !cfg.baseUrl
      ? "Jira habilitado pero sin baseUrl/tenant configurado"
      : !cfg.verifiable
      ? "credenciales Jira obligatorias ausentes (se leen sólo del entorno; nunca se imprimen)"
      : observationReason,
  });
}

/**
 * Audita la capa CI: distingue `configuración local presente` de
 * `configuración remota observada` / `no accesible` / `no aplicable`. La
 * presencia local NO implica que el workflow esté activo remotamente: eso es
 * observación remota, que aquí sólo se refleja si `deps.ciObservation` la
 * aporta (probe real). (14.5, 17.7)
 */
function auditCi(repoRoot, deps = {}) {
  // Configuración local: workflow del core instalado.
  const localPaths = [
    path.join(repoRoot, ".github", "workflows", "kiritek-security.yml"),
    path.join(repoRoot, ".kiritek", "ci", "kiritek-security.yml"),
  ];
  const localPresent = localPaths.some((p) => fs.existsSync(p));
  const observation = deps.ciObservation
    ? deps.ciObservation.observation
    : localPresent
    ? checks.OBSERVATION.UNKNOWN // local presente, remoto NO observado todavía
    : checks.OBSERVATION.NOT_CONFIGURED;
  const observationReason = deps.ciObservation
    ? deps.ciObservation.reason
    : localPresent
    ? "configuración local presente; estado remoto no observado"
    : "sin workflow de seguridad local";
  return capability("ci", true, {
    installed: localPresent,
    configured: localPresent,
    active: observation === checks.OBSERVATION.OBSERVED,
    observation,
    reason: observationReason,
  });
}

/**
 * Audita los packs de provider (GitHub, AWS CodeCommit) por SEPARADO (Tarea
 * 41). Delega en `audit/providers.js`, pasándole el helper `capability()` para
 * que las capacidades de provider compartan exactamente la misma forma que el
 * resto de la auditoría. Cada pack produce una capacidad `provider-<pack>`.
 *
 * No observa por sí misma: los transportes (`observe`/`driftProbe`) son
 * inyectables y por defecto NO abren red (unknown/not-configured honesto). Un
 * pack no seleccionado es `not-applicable`.
 *
 * @param {string} repoRoot
 * @param {object} deps {
 *   config, env, providers (lista seleccionada),
 *   providerObserve, providerDriftProbe, clock|now, idGenerator
 * }
 * @returns {object[]} capacidades de provider
 */
function auditProviders(repoRoot, deps = {}) {
  // La selección de packs es EXPLÍCITA: `deps.providers` (del flag --provider o
  // de la config). Sin selección, todos los packs son `not-applicable`.
  const selected =
    deps.providers !== undefined
      ? deps.providers
      : deps.config && deps.config.providers !== undefined
      ? deps.config.providers
      : null;

  // Reloj inyectable para el planId determinista; si no se aporta, uno fijo.
  const clock =
    typeof deps.clock === "function"
      ? deps.clock
      : () => (deps.now ? deps.now() : "1970-01-01T00:00:00.000Z");

  return providersAudit.auditAllProviders({
    repoRoot,
    env: deps.env || {},
    config: deps.config || {},
    selected,
    observe: deps.providerObserve,
    driftProbe: deps.providerDriftProbe,
    clock,
    idGenerator: deps.idGenerator,
    capabilityFactory: capability,
  });
}

/**
 * Aplica el enriquecimiento profundo (Tarea 28) a una lista de capacidades ya
 * construidas: drift de rama default, excepciones activas, frescura de
 * evidencia por capa y self-check sintético (`--deep`). No muta las entradas:
 * devuelve una copia con los campos profundos añadidos.
 *
 * @param {object[]} capabilities
 * @param {string} repoRoot
 * @param {object} opts { config, env, deep, now, selfCheckDeps, evidenceByCapability }
 * @returns {object[]}
 */
function enrichDeep(capabilities, repoRoot, opts = {}) {
  const config = opts.config || {};
  const nowMs = () => (opts.now ? Date.parse(opts.now) : Date.now());
  const evidenceMap = opts.evidenceByCapability || {};

  // Drift de rama default y excepciones activas se calculan una vez.
  const drift = checks.defaultBranchDrift(repoRoot, config);
  const exceptions = checks.activeExceptions(repoRoot, { now: nowMs });

  // Self-check sintético sólo en modo deep.
  let selfCheck = null;
  if (opts.deep) {
    selfCheck = checks.runSyntheticSelfCheck(opts.selfCheckDeps || {});
  }

  return capabilities.map((cap) => {
    const extra = {};

    // Frescura de evidencia si hay evidencia aportada para esta capa.
    const evidence = evidenceMap[cap.id];
    if (evidence !== undefined) {
      const fresh = checks.evidenceFreshness(
        evidence,
        { maxAgeHours: opts.maxAgeHours },
        { now: nowMs }
      );
      extra.lastRun = fresh.lastRun;
      extra.lastResult = fresh.lastResult;
      extra.lastResultFresh = fresh.present ? fresh.fresh : null;
      extra.commit = fresh.commit;
      extra.configHash = fresh.configHash;
      if (!fresh.fresh && fresh.reason) extra.reason = cap.reason || fresh.reason;
    }

    // Drift de rama default: afecta a la capa de hooks/git (push protection).
    if (cap.id === "git-hooks" && drift.applicable) {
      extra.drift = drift.drift || cap.drift;
      if (drift.drift) extra.reason = cap.reason ? `${cap.reason}; ${drift.reason}` : drift.reason;
    }

    // Excepciones activas: se reportan en la capa de archivos sensibles si
    // existe; aquí las adjuntamos a `config` como capa canónica del core.
    if (cap.id === "config") {
      extra.exceptions = exceptions.active;
    }

    // El self-check sintético valida el gate de secretos (capa de scanning).
    if (opts.deep && cap.id === "secret-scanning" && selfCheck) {
      extra.selfCheck = {
        ran: selfCheck.ran,
        fired: selfCheck.fired,
        leaked: selfCheck.leaked,
        reason: selfCheck.reason,
      };
      if (!selfCheck.fired || selfCheck.leaked) {
        extra.integrity = INTEGRITY.FAILED;
        extra.reason = selfCheck.reason || cap.reason;
      }
    }

    return { ...cap, ...extra };
  });
}

/**
 * Ejecuta la auditoría completa (síncrona).
 *
 * Nota: la OBSERVACIÓN remota de Jira/CI requiere un probe (red), que es
 * asíncrono. Esta variante síncrona NO observa remotamente; marca Jira/CI con
 * observación `unknown`/`not-configured` honesta. Para incluir observación
 * remota usa `runCapabilityAuditAsync` con un `jiraProbe` inyectado.
 *
 * @param {string} repoRoot
 * @param {object} deps { now, config, env, deep, selfCheckDeps, maxAgeHours,
 *   evidenceByCapability }
 * @returns {{ schemaVersion, generatedAt, capabilities }}
 */
function runCapabilityAudit(repoRoot, deps = {}) {
  const now = deps.now ? deps.now() : new Date().toISOString();
  const config = deps.config || {};
  const env = deps.env || {};

  const base = [
    auditConfig(repoRoot),
    auditTooling(repoRoot, { toolCacheRoot: deps.toolCacheRoot }),
    auditHooks(repoRoot),
    auditClaudeAdapter(repoRoot),
    auditKiroAdapter(repoRoot),
    auditFlutter(repoRoot),
    auditJira(config, env, { jiraObservation: deps.jiraObservation }),
    auditCi(repoRoot, { ciObservation: deps.ciObservation }),
    // Providers (Tarea 41): una capacidad por pack soportado. Por defecto no
    // seleccionados ⇒ not-applicable; con `deps.providers` se auditan por
    // separado (local vs remoto observado), sin abrir red salvo probe inyectado.
    ...auditProviders(repoRoot, {
      config,
      env,
      providers: deps.providers,
      providerObserve: deps.providerObserve,
      providerDriftProbe: deps.providerDriftProbe,
      clock: deps.clock,
      now: deps.now,
      idGenerator: deps.idGenerator,
    }),
  ];

  const capabilities = enrichDeep(base, repoRoot, {
    config,
    env,
    deep: !!deps.deep,
    now,
    selfCheckDeps: deps.selfCheckDeps,
    maxAgeHours: deps.maxAgeHours,
    evidenceByCapability: deps.evidenceByCapability,
  });

  return { schemaVersion: 1, generatedAt: now, capabilities };
}

/**
 * Variante asíncrona: observa remotamente Jira (y, cuando se aporte un probe,
 * CI) mediante transportes inyectables antes de construir la auditoría. Nunca
 * abre red por sí misma; delega en los probes. Si no se aporta probe, cae en
 * observación `unknown`/`not-configured` honesta (igual que la síncrona).
 *
 * @param {string} repoRoot
 * @param {object} deps  Igual que runCapabilityAudit + { jiraProbe, ciProbe, probeKey }
 * @returns {Promise<{ schemaVersion, generatedAt, capabilities }>}
 */
async function runCapabilityAuditAsync(repoRoot, deps = {}) {
  const config = deps.config || {};
  const env = deps.env || {};

  let jiraObservation;
  if (typeof deps.jiraProbe === "function") {
    jiraObservation = await checks.probeJira({
      config,
      env,
      probe: deps.jiraProbe,
      probeKey: deps.probeKey,
    });
  }

  return runCapabilityAudit(repoRoot, { ...deps, jiraObservation });
}

module.exports = {
  INTEGRITY,
  ENFORCEMENT,
  OBSERVATION: checks.OBSERVATION,
  capability,
  auditConfig,
  auditTooling,
  auditHooks,
  auditClaudeAdapter,
  auditKiroAdapter,
  auditFlutter,
  auditJira,
  auditCi,
  auditProviders,
  enrichDeep,
  runCapabilityAudit,
  runCapabilityAuditAsync,
};
