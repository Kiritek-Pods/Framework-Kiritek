"use strict";

/**
 * Almacén local y entrega remota opt-in de telemetría engineering
 * (T15A.1–T15A.3, R20.5).
 *
 * - LOCAL: sólo si `telemetry.enabled` (off por defecto). JSONL en
 *   `.kiritek/telemetry/engineering/` (ignorado por Git), con retención.
 * - REMOTO: sólo con `telemetry.enabled` + `telemetry.endpoint` https; token
 *   desde `KIRITEK_ENG_TELEMETRY_TOKEN` (nunca en config), id de
 *   instalación pseudónimo, `Idempotency-Key` por evento, timeout, anti-replay
 *   (claves entregadas y ventana de retención) y ack obligatorio.
 * - Un fallo remoto conserva el evento local como `pending`; nunca se marca
 *   `delivered` sin 2xx + ack de la misma clave.
 * - El `send` de red es inyectable: este módulo no abre conexiones por sí mismo.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DIR = ".kiritek/telemetry/engineering";
const DAY_MS = 86400000;
const DEFAULT_TIMEOUT_MS = 5000;
// Fuera del prefijo KIRITEK_ENGINEERING_*: la config rechaza credenciales ahí.
const TOKEN_ENV = "KIRITEK_ENG_TELEMETRY_TOKEN";

function telemetryError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Store en memoria (pruebas) con la misma interfaz que el de archivo. */
function createMemoryStore() {
  let events = [];
  const delivered = new Set();
  let installationId = null;
  return {
    append: (list) => events.push(...list),
    all: () => events.slice(),
    replace: (list) => (events = list.slice()),
    isDelivered: (k) => delivered.has(k),
    markDelivered: (k) => delivered.add(k),
    installationId: () => (installationId = installationId || `inst-${crypto.randomUUID()}`),
  };
}

/** Store de archivo (JSONL + claves entregadas + id pseudónimo). */
function createFileStore(repoRoot) {
  const dir = path.join(repoRoot, ...DIR.split("/"));
  const file = path.join(dir, "events.jsonl");
  const deliveredFile = path.join(dir, "delivered.json");
  const idFile = path.join(dir, "installation-id");
  const ensure = () => fs.mkdirSync(dir, { recursive: true });
  const readAll = () => {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch (_) {
          return [];
        }
      });
  };
  const readDelivered = () => {
    try {
      return new Set(JSON.parse(fs.readFileSync(deliveredFile, "utf8")));
    } catch (_) {
      return new Set();
    }
  };
  const atomic = (target, content) => {
    ensure();
    const tmp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
  };
  return {
    append(list) {
      ensure();
      fs.appendFileSync(file, list.map((e) => `${JSON.stringify(e)}\n`).join(""));
    },
    all: readAll,
    replace: (list) => atomic(file, list.map((e) => `${JSON.stringify(e)}\n`).join("")),
    isDelivered: (k) => readDelivered().has(k),
    markDelivered(k) {
      const s = readDelivered();
      s.add(k);
      atomic(deliveredFile, JSON.stringify([...s].sort()));
    },
    installationId() {
      if (fs.existsSync(idFile)) return fs.readFileSync(idFile, "utf8").trim();
      const id = `inst-${crypto.randomUUID()}`;
      atomic(idFile, `${id}\n`);
      return id;
    },
  };
}

/** Registra eventos locales (si la telemetría está activa) y aplica retención. */
function recordLocal(store, events, { telemetry, nowIso }) {
  if (!telemetry || telemetry.enabled !== true) return { recorded: 0, pruned: 0, enabled: false };
  const cutoff = Date.parse(nowIso) - (telemetry.retentionDays || 14) * DAY_MS;
  const before = store.all();
  const kept = before.filter((e) => Date.parse(e.at) >= cutoff);
  if (kept.length !== before.length) store.replace(kept);
  const seen = new Set(kept.map((e) => e.id));
  const fresh = events.filter((e) => !seen.has(e.id));
  if (fresh.length) store.append(fresh);
  return { recorded: fresh.length, pruned: before.length - kept.length, enabled: true };
}

/** Política remota; null si no está habilitada. Lanza si es insegura. */
function resolveRemote(telemetry, env = {}) {
  if (!telemetry || telemetry.enabled !== true || !telemetry.endpoint) return null;
  if (!/^https:\/\//i.test(telemetry.endpoint)) throw telemetryError("TELEMETRY_INSECURE_ENDPOINT", "telemetría remota requiere https (TLS)");
  const token = env[TOKEN_ENV];
  if (typeof token !== "string" || !token.trim()) throw telemetryError("TELEMETRY_MISSING_CREDENTIAL", `telemetría remota requiere ${TOKEN_ENV} (no se lee de la config)`);
  return { endpoint: telemetry.endpoint, token, timeoutMs: telemetry.timeoutMs || DEFAULT_TIMEOUT_MS, retentionDays: telemetry.retentionDays || 14 };
}

/**
 * Entrega remota de eventos locales pendientes.
 * @param {object} store
 * @param {object|null} remote  Salida de resolveRemote.
 * @param {(req) => Promise<{status:number, ack?:string}>} send  Transporte inyectado.
 * @returns {Promise<{delivered, pending, duplicates, expired, remote:boolean}>}
 */
async function flush(store, remote, send, { nowIso }) {
  const summary = { delivered: 0, pending: 0, duplicates: 0, expired: 0, remote: !!remote };
  const events = store.all();
  if (!remote) {
    summary.pending = events.filter((e) => !store.isDelivered(e.id)).length;
    return summary;
  }
  const pseudonym = store.installationId();
  const cutoff = Date.parse(nowIso) - remote.retentionDays * DAY_MS;
  for (const e of events) {
    if (store.isDelivered(e.id)) {
      summary.duplicates += 1;
      continue;
    }
    // Anti-replay: no se reenvían eventos fuera de la ventana de retención.
    if (Date.parse(e.at) < cutoff) {
      summary.expired += 1;
      continue;
    }
    let res;
    try {
      res = await send({
        url: remote.endpoint,
        timeoutMs: remote.timeoutMs,
        headers: { authorization: `Bearer ${remote.token}`, "idempotency-key": e.id, "x-kiritek-installation": pseudonym, "content-type": "application/json" },
        body: JSON.stringify({ installation: pseudonym, sentAt: nowIso, event: e }),
      });
    } catch (_) {
      res = null;
    }
    if (res && res.status >= 200 && res.status < 300 && res.ack === e.id) {
      store.markDelivered(e.id);
      summary.delivered += 1;
    } else {
      summary.pending += 1;
    }
  }
  return summary;
}

/**
 * Transporte HTTPS real (sólo `telemetry flush` explícito). Respuesta:
 * `{ status, ack }` con `ack` = cabecera `x-kiritek-ack` del destino.
 */
function httpsSend({ url, headers, body, timeoutMs }) {
  const https = require("node:https");
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, timeout: timeoutMs }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, ack: res.headers["x-kiritek-ack"] }));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "TELEMETRY_TIMEOUT" })));
    req.on("error", reject);
    req.end(body);
  });
}

module.exports = { DIR, TOKEN_ENV, createMemoryStore, createFileStore, recordLocal, resolveRemote, flush, httpsSend };
