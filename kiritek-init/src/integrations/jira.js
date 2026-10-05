"use strict";

/**
 * Validador remoto de existencia de claves Jira (Tarea 23, requisitos 10.1–10.7).
 *
 * Complementa la validación SINTÁCTICA local de `policy/commits.js` (Tarea 22):
 * aquí se consulta un API/MCP configurable para confirmar que cada clave NUEVA
 * del rango de un push existe y es accesible. El resultado es un `PolicyResult`
 * del contrato compartido (`domain/result.js`).
 *
 * Principios de diseño (no negociables):
 *  - Las credenciales vienen SÓLO del entorno/secret store (`env`), nunca de la
 *    configuración del proyecto ni de archivos versionados, y JAMÁS se imprimen
 *    ni se incluyen en resultados/evidencia/caché. (10.6, 13.8, G.12)
 *  - El transporte (HTTP/MCP) es inyectable: las pruebas usan un mock. Este
 *    módulo NUNCA abre una conexión de red por sí mismo; delega en `transport`.
 *  - Timeout, rate limiting y deduplicación de claves son obligatorios. (10.1)
 *  - La caché se indexa por tenant (baseURL) + clave, con TTL, y no se reutiliza
 *    entre instancias/tenants distintos; no registra metadata sensible. (10.7)
 *  - Una respuesta "no existe" / "política inválida" DENIEGA. La indisponibilidad
 *    aplica `fail-closed|warn` según modo. (10.3, 10.4)
 *  - En fallback `warn` el estado es `no_verificado_remotamente`, nunca
 *    `verificado`. (10.5)
 *  - `clock` e `idGenerator` son inyectables para pruebas deterministas.
 */

const result = require("../domain/result.js");
const { createEvidence } = require("../domain/evidence.js");

const CONTROL_ID = "jira.remote-existence";

/** Estados de verificación remota expuestos en la metadata del resultado. */
const REMOTE_STATE = Object.freeze({
  VERIFIED: "verificado",
  NOT_VERIFIED_REMOTELY: "no_verificado_remotamente",
  INVALID: "invalid",
  NOT_FOUND: "does-not-exist",
  UNAVAILABLE: "unavailable",
  NOT_CONFIGURED: "not_configured",
});

/** Outcome por clave devuelto por el transporte, ya normalizado. */
const OUTCOME = Object.freeze({
  EXISTS: "exists",
  ACCESSIBLE: "accessible",
  INVALID_POLICY: "invalid-policy",
  DOES_NOT_EXIST: "does-not-exist",
  UNAUTHORIZED: "401",
  RATE_LIMITED: "429",
  TIMEOUT: "timeout",
  ERROR: "error",
});

/** Un outcome es "definitivamente negativo" (deniega siempre). */
const DEFINITIVE_NEGATIVE = Object.freeze([OUTCOME.DOES_NOT_EXIST, OUTCOME.INVALID_POLICY]);
/** Un outcome es "indisponibilidad" (aplica fail-closed|warn según modo). */
const UNAVAILABLE_OUTCOMES = Object.freeze([
  OUTCOME.UNAUTHORIZED,
  OUTCOME.RATE_LIMITED,
  OUTCOME.TIMEOUT,
  OUTCOME.ERROR,
]);
/** Un outcome es "positivo" (la clave existe y es accesible). */
const POSITIVE_OUTCOMES = Object.freeze([OUTCOME.EXISTS, OUTCOME.ACCESSIBLE]);

/**
 * Resuelve la política Jira remota desde la config efectiva, con defaults.
 */
function resolveRemotePolicy(config = {}) {
  const j = (config && config.jira) || {};
  return {
    enabled: j.enabled === true,
    baseUrl: typeof j.baseUrl === "string" && j.baseUrl.trim() !== "" ? j.baseUrl.trim() : null,
    transport: j.transport === "mcp" ? "mcp" : "rest",
    timeoutMs: Number.isInteger(j.timeoutMs) && j.timeoutMs > 0 ? j.timeoutMs : 5000,
    rateLimitPerMinute:
      Number.isInteger(j.rateLimitPerMinute) && j.rateLimitPerMinute > 0 ? j.rateLimitPerMinute : 60,
    cacheTtlSeconds: Number.isInteger(j.cacheTtlSeconds) && j.cacheTtlSeconds >= 0 ? j.cacheTtlSeconds : 300,
    requireCredentials: j.requireCredentials === true,
    unavailable: j.unavailable === "warn" ? "warn" : "fail-closed",
  };
}

/**
 * Resuelve credenciales SÓLO desde el entorno/secret store. Devuelve un objeto
 * opaco que el transporte usa; este módulo nunca lee su valor. Si faltan,
 * `present` es false. NUNCA se imprime ni se serializa el valor.
 *
 * Variables reconocidas:
 *  - KIRITEK_JIRA_TOKEN  (token / API token / PAT)
 *  - KIRITEK_JIRA_EMAIL  (opcional, para auth básica estilo Atlassian Cloud)
 */
function resolveCredentials(env = {}) {
  const token = typeof env.KIRITEK_JIRA_TOKEN === "string" ? env.KIRITEK_JIRA_TOKEN : "";
  const email = typeof env.KIRITEK_JIRA_EMAIL === "string" ? env.KIRITEK_JIRA_EMAIL : "";
  const present = token.trim() !== "";
  // El valor se guarda en un closure/propiedad no enumerable para reducir el
  // riesgo de que termine en un JSON.stringify accidental.
  const creds = { present };
  Object.defineProperty(creds, "token", { value: token, enumerable: false });
  Object.defineProperty(creds, "email", { value: email, enumerable: false });
  return creds;
}

/**
 * Caché segura de verificaciones Jira. Indexada por tenant (baseURL) + clave,
 * con expiración por entrada. No almacena credenciales ni payloads: sólo el
 * outcome normalizado y su timestamp de expiración. No se reutiliza entre
 * tenants distintos porque el tenant forma parte de la llave. (10.7)
 */
class JiraCache {
  constructor({ clock } = {}) {
    this._clock = clock || (() => Date.now());
    this._store = new Map();
  }

  static _key(tenant, key) {
    // El separador `\u0000` no puede aparecer en una baseURL ni en una clave,
    // así que no hay colisión posible entre tenant+key distintos.
    return `${tenant}\u0000${key}`;
  }

  get(tenant, key) {
    const k = JiraCache._key(tenant, key);
    const entry = this._store.get(k);
    if (!entry) return undefined;
    if (entry.expiresAt <= this._clock()) {
      this._store.delete(k);
      return undefined;
    }
    return entry.outcome;
  }

  set(tenant, key, outcome, ttlSeconds) {
    if (!(ttlSeconds > 0)) return; // TTL 0 => no se cachea
    const k = JiraCache._key(tenant, key);
    this._store.set(k, { outcome, expiresAt: this._clock() + ttlSeconds * 1000 });
  }

  get size() {
    return this._store.size;
  }
}

/**
 * Limitador de tasa simple por ventana (token bucket discreto por minuto).
 * Determinista con `clock` inyectable para pruebas.
 */
class RateLimiter {
  constructor({ perMinute, clock } = {}) {
    this._perMinute = perMinute > 0 ? perMinute : 60;
    this._clock = clock || (() => Date.now());
    this._windowStart = this._clock();
    this._count = 0;
  }

  /** @returns {boolean} true si se permite la petición ahora. */
  allow() {
    const now = this._clock();
    if (now - this._windowStart >= 60000) {
      this._windowStart = now;
      this._count = 0;
    }
    if (this._count >= this._perMinute) return false;
    this._count += 1;
    return true;
  }
}

/**
 * Deduplica una lista de claves preservando el orden de primera aparición.
 */
function dedupeKeys(keys) {
  const seen = new Set();
  const out = [];
  for (const k of keys || []) {
    if (typeof k !== "string" || k.trim() === "") continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Normaliza la respuesta del transporte a un OUTCOME. El transporte debe
 * devolver `{ status: <number|"timeout">, exists?: boolean, policyOk?: boolean }`
 * o lanzar un error con `.code === "ETIMEDOUT"` para timeout.
 */
function normalizeOutcome(resp) {
  if (!resp || typeof resp !== "object") return OUTCOME.ERROR;
  if (resp.status === "timeout") return OUTCOME.TIMEOUT;
  const status = resp.status;
  if (status === 401 || status === 403) return OUTCOME.UNAUTHORIZED;
  if (status === 429) return OUTCOME.RATE_LIMITED;
  if (status === 404) return OUTCOME.DOES_NOT_EXIST;
  if (status === 200) {
    if (resp.exists === false) return OUTCOME.DOES_NOT_EXIST;
    if (resp.policyOk === false) return OUTCOME.INVALID_POLICY;
    return resp.accessible === false ? OUTCOME.EXISTS : OUTCOME.ACCESSIBLE;
  }
  if (typeof status === "number" && status >= 500) return OUTCOME.ERROR;
  return OUTCOME.ERROR;
}

/**
 * Consulta remota de una clave a través del transporte inyectado, con timeout y
 * rate limit ya aplicados por el llamador.
 *
 * @param {object} ctx { transport, policy, credentials, clock }
 * @param {string} key
 * @returns {Promise<string>} OUTCOME
 */
async function queryKey(ctx, key) {
  const { transport, policy, credentials } = ctx;
  let resp;
  try {
    resp = await withTimeout(
      transport({
        baseUrl: policy.baseUrl,
        transport: policy.transport,
        key,
        credentials, // objeto opaco; el transporte no debe filtrarlo
      }),
      policy.timeoutMs,
      ctx.clock
    );
  } catch (err) {
    if (err && err.code === "ETIMEDOUT") return OUTCOME.TIMEOUT;
    return OUTCOME.ERROR;
  }
  return normalizeOutcome(resp);
}

/**
 * Envuelve una promesa con un timeout determinista. No usa el reloj de pared si
 * se inyecta `clock`; para pruebas el transporte mock resuelve de inmediato.
 */
function withTimeout(promise, timeoutMs, _clock) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error("jira: timeout");
      err.code = "ETIMEDOUT";
      reject(err);
    }, timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * ¿Un conjunto de outcomes implica un veredicto negativo definitivo?
 */
function hasDefinitiveNegative(outcomesByKey) {
  return Object.values(outcomesByKey).some((o) => DEFINITIVE_NEGATIVE.includes(o));
}
function allPositive(outcomesByKey) {
  const values = Object.values(outcomesByKey);
  return values.length > 0 && values.every((o) => POSITIVE_OUTCOMES.includes(o));
}
function hasUnavailable(outcomesByKey) {
  return Object.values(outcomesByKey).some((o) => UNAVAILABLE_OUTCOMES.includes(o));
}

/**
 * Verifica remotamente un conjunto de claves y devuelve un `PolicyResult`
 * extendido con `meta` NO sensible y `evidence`.
 *
 * @param {object} input
 * @param {string[]} input.keys        Claves Jira sintácticas del alcance.
 * @param {string}   input.mode        "warning" | "enforce".
 * @param {object}   input.config      Config efectiva.
 * @param {object}   input.env         Entorno (fuente de credenciales).
 * @param {string}   [input.scope]     Alcance (p. ej. "push" | "ci").
 * @param {object}   deps
 * @param {Function} deps.transport    async ({baseUrl,key,credentials}) => resp
 * @param {JiraCache} [deps.cache]
 * @param {Function} [deps.clock]      () => epoch ms
 * @param {Function} [deps.idGenerator]
 * @returns {Promise<object>} PolicyResult + { meta, evidence }
 */
async function verifyKeys(input, deps) {
  const mode = input.mode === "enforce" ? "enforce" : "warning";
  const scope = typeof input.scope === "string" && input.scope.trim() !== "" ? input.scope : "push";
  const policy = resolveRemotePolicy(input.config || {});
  const credentials = resolveCredentials(input.env || {});
  const clock = (deps && deps.clock) || (() => Date.now());
  const idGenerator = deps && deps.idGenerator;
  const transport = deps && deps.transport;
  const cache = (deps && deps.cache) || new JiraCache({ clock });

  const keys = dedupeKeys(input.keys);

  // --- Jira deshabilitado o sin tenant: no es una afirmación remota ---
  if (!policy.enabled) {
    return finalize({
      decision: result.DECISION.ALLOW,
      remoteState: REMOTE_STATE.NOT_CONFIGURED,
      reason: undefined,
      meta: baseMeta(policy, keys, {}, { skipped: "jira-disabled" }),
      mode,
      scope,
      policy,
      clock,
      idGenerator,
      exitHint: 0,
    });
  }

  if (!policy.baseUrl) {
    // Habilitado pero sin tenant configurado: tratamos como indisponibilidad.
    return applyUnavailable({
      mode,
      scope,
      policy,
      meta: baseMeta(policy, keys, {}, { reason: "jira-base-url-missing" }),
      reason: "Jira habilitado pero sin baseUrl/tenant configurado",
      clock,
      idGenerator,
    });
  }

  // --- Credenciales obligatorias ausentes: fallar sin imprimir el valor ---
  if (policy.requireCredentials && !credentials.present) {
    return applyMissingCredentials({ mode, scope, policy, keys, clock, idGenerator });
  }

  if (typeof transport !== "function") {
    throw new TypeError("verifyKeys requiere deps.transport (función de consulta)");
  }

  if (keys.length === 0) {
    // No hay claves nuevas que verificar: nada que denegar remotamente.
    return finalize({
      decision: result.DECISION.ALLOW,
      remoteState: REMOTE_STATE.NOT_CONFIGURED,
      reason: undefined,
      meta: baseMeta(policy, keys, {}, { skipped: "no-keys" }),
      mode,
      scope,
      policy,
      clock,
      idGenerator,
      exitHint: 0,
    });
  }

  const limiter = new RateLimiter({ perMinute: policy.rateLimitPerMinute, clock });
  const ctx = { transport, policy, credentials, clock };
  const outcomesByKey = {};
  const fromCache = {};

  for (const key of keys) {
    const cached = cache.get(policy.baseUrl, key);
    if (cached !== undefined) {
      outcomesByKey[key] = cached;
      fromCache[key] = true;
      continue;
    }
    if (!limiter.allow()) {
      // Rate limit local alcanzado: lo tratamos como indisponibilidad para esta
      // clave (no se consulta), nunca como verificado.
      outcomesByKey[key] = OUTCOME.RATE_LIMITED;
      continue;
    }
    const outcome = await queryKey(ctx, key);
    outcomesByKey[key] = outcome;
    // Sólo se cachean veredictos estables (positivos/negativos definitivos),
    // nunca la indisponibilidad transitoria.
    if (POSITIVE_OUTCOMES.includes(outcome) || DEFINITIVE_NEGATIVE.includes(outcome)) {
      cache.set(policy.baseUrl, key, outcome, policy.cacheTtlSeconds);
    }
  }

  const meta = baseMeta(policy, keys, outcomesByKey, { fromCache });

  // 1) Negativa definitiva => deniega (en warning degrada a warn).
  if (hasDefinitiveNegative(outcomesByKey)) {
    const bad = keys.filter((k) => DEFINITIVE_NEGATIVE.includes(outcomesByKey[k]));
    const decision = mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;
    return finalize({
      decision,
      remoteState: bad.some((k) => outcomesByKey[k] === OUTCOME.INVALID_POLICY)
        ? REMOTE_STATE.INVALID
        : REMOTE_STATE.NOT_FOUND,
      reason: `clave(s) Jira sin existencia/política válida: ${bad.join(", ")}`,
      remediation:
        "Verifica que la clave del ticket exista y cumpla la política del proyecto Jira. " +
        "La validación remota no revela credenciales.",
      meta,
      mode,
      scope,
      policy,
      clock,
      idGenerator,
      exitHint: 1,
    });
  }

  // 2) Indisponibilidad => fail-closed|warn según modo.
  if (hasUnavailable(outcomesByKey)) {
    return applyUnavailable({
      mode,
      scope,
      policy,
      meta,
      reason: "Jira temporalmente no disponible para una o más claves",
      clock,
      idGenerator,
    });
  }

  // 3) Todo positivo => verificado y allow.
  if (allPositive(outcomesByKey)) {
    return finalize({
      decision: result.DECISION.ALLOW,
      remoteState: REMOTE_STATE.VERIFIED,
      reason: undefined,
      meta,
      mode,
      scope,
      policy,
      clock,
      idGenerator,
      exitHint: 0,
    });
  }

  // Defensa: cualquier combinación no cubierta se trata como indisponibilidad.
  return applyUnavailable({
    mode,
    scope,
    policy,
    meta,
    reason: "resultado remoto Jira indeterminado",
    clock,
    idGenerator,
  });
}

/**
 * Aplica el fallback de indisponibilidad: `fail-closed` deniega (deny en
 * enforce, warn en warning); `warn` degrada a warn y marca el estado como
 * `no_verificado_remotamente`, NUNCA `verificado`. (10.4, 10.5)
 */
function applyUnavailable({ mode, scope, policy, meta, reason, clock, idGenerator }) {
  const failClosed = policy.unavailable === "fail-closed";
  let decision;
  if (failClosed) {
    decision = mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;
  } else {
    decision = result.DECISION.WARN;
  }
  const exitHint = decision === result.DECISION.DENY ? 1 : 0;
  const metaOut = { ...meta, fallback: policy.unavailable };
  return finalize({
    decision,
    remoteState: REMOTE_STATE.NOT_VERIFIED_REMOTELY,
    reason,
    remediation:
      policy.unavailable === "fail-closed"
        ? "Reintenta cuando Jira esté disponible o ajusta jira.unavailable=warn durante el rollout."
        : "Resultado no verificado remotamente; se continúa con advertencia auditable.",
    meta: metaOut,
    mode,
    scope,
    policy,
    clock,
    idGenerator,
    exitHint,
  });
}

/**
 * Credenciales obligatorias ausentes: falla SIN imprimir el valor y explica
 * cómo configurarlas vía secret store. (10.6)
 */
function applyMissingCredentials({ mode, scope, policy, keys, clock, idGenerator }) {
  const decision = mode === "enforce" ? result.DECISION.ERROR : result.DECISION.WARN;
  const meta = baseMeta(policy, keys, {}, { credentials: "missing" });
  const reason =
    "faltan credenciales Jira obligatorias; configúralas en el secret store/entorno " +
    "(KIRITEK_JIRA_TOKEN) sin incluirlas en archivos de configuración";
  return finalize({
    decision,
    remoteState: REMOTE_STATE.NOT_VERIFIED_REMOTELY,
    reason,
    remediation:
      "Exporta KIRITEK_JIRA_TOKEN (y KIRITEK_JIRA_EMAIL si aplica) desde el secret store del entorno. " +
      "El valor nunca se imprime ni se persiste.",
    meta,
    mode,
    scope,
    policy,
    clock,
    idGenerator,
    exitHint: decision === result.DECISION.ERROR ? 1 : 0,
    errorToolStatus: decision === result.DECISION.ERROR,
  });
}

/**
 * Metadata NO sensible para el resultado. Nunca contiene credenciales ni
 * payloads: sólo tenant (baseURL, no credencial), estado por clave, banderas.
 */
function baseMeta(policy, keys, outcomesByKey, extra = {}) {
  return {
    validation: "remote",
    tenant: policy.baseUrl || null,
    transport: policy.transport,
    enabled: policy.enabled,
    keys: [...keys],
    outcomes: { ...outcomesByKey },
    ...extra,
  };
}

/**
 * Construye el PolicyResult final + evidencia mínima redactable.
 */
function finalize(args) {
  const {
    decision,
    remoteState,
    reason,
    remediation,
    meta,
    scope,
    policy,
    clock,
    idGenerator,
    exitHint,
    errorToolStatus,
  } = args;

  const toolStatus =
    decision === result.DECISION.ERROR || errorToolStatus
      ? result.TOOL_STATUS.UNAVAILABLE
      : result.TOOL_STATUS.OK;

  const res = result.createResult({
    controlId: CONTROL_ID,
    decision,
    toolStatus: decision === result.DECISION.ALLOW ? result.TOOL_STATUS.OK : toolStatus,
    reason: decision === result.DECISION.ALLOW ? undefined : reason,
    remediation: decision === result.DECISION.ALLOW ? undefined : remediation,
    scope,
  });

  const createdAtIso = new Date(clock()).toISOString();
  const evidence = createEvidence(
    {
      control: CONTROL_ID,
      command: `kiritek-init validate push (jira:${scope})`,
      toolVersion: `jira-remote/${policy.transport}`,
      // Hash del tenant+config remota (sin credenciales): la baseURL no es un
      // secreto, pero igual lo hasheamos para evidencia estable.
      configHash: hashRemote(policy),
      scope,
      exitCode: typeof exitHint === "number" ? exitHint : 0,
      decision,
      createdAt: createdAtIso,
    },
    { idGenerator }
  );

  const fullMeta = {
    ...meta,
    remoteState,
    // Garantía explícita del contrato: en fallback nunca es "verificado".
    verified: remoteState === REMOTE_STATE.VERIFIED,
  };

  return Object.freeze({
    ...res,
    meta: Object.freeze(deepFreeze(fullMeta)),
    evidence,
  });
}

function hashRemote(policy) {
  const crypto = require("crypto");
  const material = JSON.stringify({
    baseUrl: policy.baseUrl,
    transport: policy.transport,
    timeoutMs: policy.timeoutMs,
    rateLimitPerMinute: policy.rateLimitPerMinute,
    cacheTtlSeconds: policy.cacheTtlSeconds,
    unavailable: policy.unavailable,
  });
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Transporte REST por defecto para el CLI. Usa `fetch` nativo (Node >=18). NO
 * se usa en pruebas: los tests inyectan un transporte mock, de modo que nunca
 * hay una conexión de red real en la suite. Las credenciales se envían en el
 * header `Authorization` y nunca se registran ni se devuelven.
 *
 * @param {object} [opts] { fetchImpl } para inyección avanzada.
 * @returns {Function} async ({baseUrl, key, credentials, transport}) => resp
 */
function createRestTransport(opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  return async function restTransport({ baseUrl, key, credentials }) {
    if (!fetchImpl) {
      const err = new Error("fetch no disponible en este runtime");
      err.code = "ENOFETCH";
      throw err;
    }
    const url = `${baseUrl.replace(/\/+$/, "")}/rest/api/2/issue/${encodeURIComponent(key)}?fields=key`;
    const headers = { Accept: "application/json" };
    if (credentials && credentials.present) {
      // Atlassian Cloud: Basic email:token; Server/DC: Bearer token.
      if (credentials.email && credentials.email.trim() !== "") {
        const basic = Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64");
        headers.Authorization = `Basic ${basic}`;
      } else {
        headers.Authorization = `Bearer ${credentials.token}`;
      }
    }
    const resp = await fetchImpl(url, { method: "GET", headers });
    // Sólo devolvemos el status y banderas; nunca el cuerpo ni los headers.
    return { status: resp.status, exists: resp.status === 200 };
  };
}

module.exports = {
  CONTROL_ID,
  REMOTE_STATE,
  OUTCOME,
  createRestTransport,
  DEFINITIVE_NEGATIVE,
  UNAVAILABLE_OUTCOMES,
  POSITIVE_OUTCOMES,
  JiraCache,
  RateLimiter,
  resolveRemotePolicy,
  resolveCredentials,
  dedupeKeys,
  normalizeOutcome,
  verifyKeys,
};
