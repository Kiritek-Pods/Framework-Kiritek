"use strict";

/**
 * Entrega de telemetría del core de seguridad Kiritek (Tarea 34, requisitos
 * 13.6–13.7, 25.3, 25.6, G.12).
 *
 * Dos destinos:
 *  - LOCAL: siempre disponible; acumula eventos en un store inyectable. Es la
 *    verdad: un evento se considera registrado localmente aunque el remoto falle.
 *  - REMOTO: OPCIONAL y de doble opt-in. Exige:
 *      · opt-in explícito (`telemetry.enabled` y `telemetry.remote.enabled`),
 *      · TLS: sólo `https://` (se RECHAZA `http://`),
 *      · autenticación (scheme + credencial desde entorno/secret store),
 *      · identificador pseudónimo configurable,
 *      · idempotency key por evento (anti-duplicado en el destino),
 *      · timeout,
 *      · anti-replay (dedupe local de keys ya confirmadas),
 *      · política de retención,
 *      · destino documentado.
 *
 * Garantías de entrega (13.7):
 *  - Si el remoto falla, el evento se CONSERVA local y queda `pending`.
 *  - Un evento NUNCA se marca `delivered` sin confirmación explícita del
 *    transporte (status 2xx + ack). Sin ack, no hay delivered.
 *
 * El `transport` (función de red) es INYECTABLE. Este módulo nunca abre una
 * conexión por sí mismo: las pruebas usan un mock. (sin red real en tests)
 *
 * `clock` e `idGenerator` son inyectables para pruebas deterministas.
 */

const { sanitizeEvent } = require("./events.js");

/** Estados de entrega de un registro de evento. */
const DELIVERY = Object.freeze({
  LOCAL_ONLY: "local_only", // telemetría local, sin remoto configurado/habilitado.
  PENDING: "pending", // intento remoto fallido; conservado local para reintento.
  DELIVERED: "delivered", // confirmado por el remoto (ack).
  DUPLICATE: "duplicate", // ya entregado antes (anti-replay): no se reenvía.
});

/**
 * Store local en memoria por defecto. Las integraciones (hooks/CI/audit) pueden
 * inyectar un store persistente con la misma interfaz.
 */
function createMemoryStore() {
  const events = [];
  const deliveredKeys = new Set();
  return {
    append(record) {
      events.push(record);
    },
    all() {
      return events.slice();
    },
    hasDelivered(idempotencyKey) {
      return deliveredKeys.has(idempotencyKey);
    },
    markDelivered(idempotencyKey) {
      deliveredKeys.add(idempotencyKey);
    },
    pending() {
      return events.filter((r) => r.delivery === DELIVERY.PENDING);
    },
  };
}

/**
 * Resuelve y valida la política remota. Devuelve `{ remoteEnabled, policy }`.
 * Lanza si la configuración remota existe pero es insegura (http, sin auth...).
 * (13.6, 25.3)
 */
function resolveRemotePolicy(config = {}, env = {}) {
  const t = (config && config.telemetry) || {};
  // Doble opt-in: la telemetría global debe estar on y el remoto habilitado.
  if (t.enabled !== true) return { remoteEnabled: false, policy: null };
  const r = t.remote;
  if (!r || r.enabled !== true) return { remoteEnabled: false, policy: null };

  // TLS obligatorio: sólo https. Rechazar http explícitamente. (13.6)
  if (typeof r.endpoint !== "string" || !/^https:\/\//i.test(r.endpoint)) {
    const err = new Error("telemetría remota requiere un endpoint https:// (TLS obligatorio)");
    err.code = "TELEMETRY_INSECURE_ENDPOINT";
    throw err;
  }
  if (/^http:\/\//i.test(r.endpoint)) {
    const err = new Error("telemetría remota: http:// no permitido");
    err.code = "TELEMETRY_INSECURE_ENDPOINT";
    throw err;
  }

  // Autenticación obligatoria. El token viene del entorno/secret store, nunca
  // de la config versionada; aquí sólo se resuelve, nunca se imprime.
  if (!r.auth || typeof r.auth.scheme !== "string") {
    const err = new Error("telemetría remota requiere autenticación (auth.scheme)");
    err.code = "TELEMETRY_NO_AUTH";
    throw err;
  }
  const token =
    r.auth.token !== undefined
      ? r.auth.token
      : env.KIRITEK_TELEMETRY_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    const err = new Error("telemetría remota: credencial ausente (sin imprimir el valor)");
    err.code = "TELEMETRY_MISSING_CREDENTIAL";
    throw err;
  }

  // Identificador pseudónimo configurable obligatorio. (25.3)
  if (typeof r.pseudonymousId !== "string" || r.pseudonymousId.trim() === "") {
    const err = new Error("telemetría remota requiere pseudonymousId configurable");
    err.code = "TELEMETRY_NO_PSEUDONYMOUS_ID";
    throw err;
  }
  if (!Number.isInteger(r.timeoutMs) || r.timeoutMs < 1) {
    const err = new Error("telemetría remota requiere timeoutMs >= 1");
    err.code = "TELEMETRY_NO_TIMEOUT";
    throw err;
  }
  if (!Number.isInteger(r.retentionDays) || r.retentionDays < 1) {
    const err = new Error("telemetría remota requiere política de retención (retentionDays)");
    err.code = "TELEMETRY_NO_RETENTION";
    throw err;
  }
  if (typeof r.destinationDoc !== "string" || r.destinationDoc.trim() === "") {
    const err = new Error("telemetría remota requiere un destino documentado (destinationDoc)");
    err.code = "TELEMETRY_NO_DESTINATION_DOC";
    throw err;
  }

  return {
    remoteEnabled: true,
    policy: {
      endpoint: r.endpoint,
      authScheme: r.auth.scheme,
      token, // nunca se incluye en registros/eventos; sólo se pasa al transport.
      pseudonymousId: r.pseudonymousId,
      timeoutMs: r.timeoutMs,
      retentionDays: r.retentionDays,
      destinationDoc: r.destinationDoc,
    },
  };
}

let keyCounter = 0;
const defaultIdGenerator = () => {
  keyCounter += 1;
  return `idem-${Date.now().toString(36)}-${keyCounter.toString(36)}`;
};
const defaultClock = () => new Date().toISOString();

/**
 * Crea un emisor de telemetría.
 *
 * @param {object} opts
 * @param {object} opts.config               configuración efectiva (telemetry.*).
 * @param {object} [opts.env]                 entorno (para credenciales).
 * @param {object} [opts.store]               store local (default: memoria).
 * @param {function} [opts.transport]         async (request) => { status, ack }.
 * @param {function} [opts.clock]             () => ISO timestamp.
 * @param {function} [opts.idGenerator]       () => idempotency key único.
 */
function createEmitter(opts = {}) {
  const config = opts.config || {};
  const env = opts.env || {};
  const store = opts.store || createMemoryStore();
  const transport = opts.transport || null;
  const clock = opts.clock || defaultClock;
  const idGenerator = opts.idGenerator || defaultIdGenerator;

  // Telemetría apagada por defecto: `emit` registra local pero jamás intenta
  // red si la telemetría global está off.
  const telemetryOn = config.telemetry && config.telemetry.enabled === true;

  // Resolver política remota una vez (lanza si es insegura y está habilitada).
  let remote = { remoteEnabled: false, policy: null };
  if (telemetryOn) {
    remote = resolveRemotePolicy(config, env);
  }

  /**
   * Emite un evento. Siempre lo conserva local. Intenta remoto sólo si hay
   * opt-in + política válida + transport inyectado.
   *
   * @param {object} event evento YA construido por events.js (se re-sanea).
   * @returns {Promise<object>} registro con { event, delivery, idempotencyKey }.
   */
  async function emit(event) {
    // Re-saneo defensivo: aunque el evento venga del builder, nunca confiamos.
    const safe = sanitizeEvent(event);

    const idempotencyKey = idGenerator();
    const record = {
      event: safe,
      idempotencyKey,
      delivery: DELIVERY.LOCAL_ONLY,
      attemptedAt: null,
      confirmedAt: null,
    };

    // Sin opt-in remoto o sin transport: queda local_only. (telemetría local)
    if (!telemetryOn || !remote.remoteEnabled || typeof transport !== "function") {
      store.append(record);
      return record;
    }

    // Anti-replay: si esta key (o el id de evento ya confirmado) se entregó,
    // no se reenvía. Aquí la key es nueva, así que el anti-replay real opera
    // sobre reintentos de un record pendiente (ver `flushPending`).
    record.delivery = DELIVERY.PENDING;
    record.attemptedAt = clock();
    store.append(record);

    await attemptDelivery(record);
    return record;
  }

  /**
   * Intenta entregar un record pendiente. Marca `delivered` SÓLO si el
   * transporte confirma (status 2xx + ack === true). Cualquier otra cosa deja
   * el record en `pending` (conservado local). (13.7)
   */
  async function attemptDelivery(record) {
    // Anti-replay: no reenviar lo ya confirmado por esta key.
    if (store.hasDelivered(record.idempotencyKey)) {
      record.delivery = DELIVERY.DUPLICATE;
      return record;
    }

    const request = {
      endpoint: remote.policy.endpoint,
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `${remote.policy.authScheme} ${remote.policy.token}`,
        "idempotency-key": record.idempotencyKey,
        "x-kiritek-pseudonymous-id": remote.policy.pseudonymousId,
      },
      timeoutMs: remote.policy.timeoutMs,
      // El cuerpo lleva el evento ya saneado + metadatos de retención/id.
      body: {
        pseudonymousId: remote.policy.pseudonymousId,
        retentionDays: remote.policy.retentionDays,
        destinationDoc: remote.policy.destinationDoc,
        event: record.event,
      },
    };

    let response;
    try {
      response = await transport(request);
    } catch (err) {
      // Fallo de red/timeout: conservar local, seguir pendiente. (13.7)
      record.delivery = DELIVERY.PENDING;
      record.lastError = classifyError(err);
      return record;
    }

    const ok =
      response &&
      typeof response.status === "number" &&
      response.status >= 200 &&
      response.status < 300 &&
      response.ack === true;

    if (ok) {
      record.delivery = DELIVERY.DELIVERED;
      record.confirmedAt = clock();
      store.markDelivered(record.idempotencyKey);
    } else {
      // Sin ack explícito NO se marca delivered: queda pendiente. (13.7)
      record.delivery = DELIVERY.PENDING;
      record.lastError = response ? `status_${response.status || "no_status"}` : "no_response";
    }
    return record;
  }

  /**
   * Reintenta todos los pendientes (p. ej. tras recuperar conectividad). El
   * anti-replay evita entregar dos veces el mismo evento confirmado.
   */
  async function flushPending() {
    const results = [];
    for (const record of store.pending()) {
      record.attemptedAt = clock();
      results.push(await attemptDelivery(record));
    }
    return results;
  }

  return {
    emit,
    flushPending,
    store,
    remoteEnabled: remote.remoteEnabled,
    telemetryOn: Boolean(telemetryOn),
  };
}

/** Clasifica un error de transporte en una categoría (nunca el mensaje crudo). */
function classifyError(err) {
  if (!err) return "unknown";
  if (err.code === "ETIMEDOUT" || err.name === "TimeoutError" || /timeout/i.test(err.message || "")) {
    return "timeout";
  }
  return "network";
}

module.exports = {
  DELIVERY,
  createEmitter,
  createMemoryStore,
  resolveRemotePolicy,
  classifyError,
};
