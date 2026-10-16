"use strict";

/**
 * Piezas comunes de los harness de backend (T32–T37). El adapter del equipo
 * expone su handler HTTP en proceso:
 *
 *   handle({ method, path, query, headers, body, ip }) → Promise<{ status, headers, body }>
 *
 * El harness sólo deriva hechos (códigos, booleanos, conteos): nunca guarda
 * cuerpos ni headers en la traza.
 */

const { settle } = require("./settle.js");

/** Respuesta normalizada: status numérico, headers en minúsculas, body como objeto o texto. */
function normalize(res) {
  if (!res || typeof res !== "object") return { status: 0, headers: {}, body: null, text: "" };
  const headers = {};
  for (const [k, v] of Object.entries(res.headers || {})) headers[String(k).toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  let body = res.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {
      /* texto plano */
    }
  }
  const text = typeof res.body === "string" ? res.body : JSON.stringify(res.body === undefined ? null : res.body);
  return { status: Number(res.status) || 0, headers, body, text };
}

/** Llama al handler bajo reloj virtual. `null` si no respondió dentro del límite. */
async function call(sut, req, clock, limitMs = 10000) {
  const state = await settle(() => sut.handle({ query: {}, headers: {}, ip: "203.0.113.10", ...req }), clock, limitMs);
  if (!state) return null;
  if (!state.ok) return { status: 0, headers: {}, body: null, text: "", threw: true };
  return normalize(state.v);
}

/** Señales de fuga de detalles internos en una respuesta al cliente. */
const LEAK_RES = [
  /\bat [\w$.<>]+ \(?[^)\s]*:\d+:\d+\)?/, // stack trace de JS
  /\bat [\w.$]+\([\w]+\.java:\d+\)/, // stack trace de Java
  /Traceback \(most recent call last\)/,
  /(?:^|[\s"'(])\/(?:srv|home|usr|var|app|opt)\/[\w./-]+/, // rutas del servidor
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+[\w*]/, // SQL
  /\bECONNREFUSED\b|\bETIMEDOUT\b/,
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b/, // IPs internas
  /kcanary-internal/i,
];
const leaks = (text) => LEAK_RES.some((re) => re.test(String(text || "")));

const is2xx = (s) => s >= 200 && s < 300;
const is4xx = (s) => s >= 400 && s < 500;
const is5xx = (s) => s >= 500 && s < 600;

module.exports = { normalize, call, leaks, is2xx, is4xx, is5xx };
