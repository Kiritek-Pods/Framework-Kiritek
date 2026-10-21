"use strict";

/** Lectura mínima del formato de exposición de Prometheus (texto 0.0.4). */

function parseLabels(s) {
  const out = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/\\(.)/g, "$1");
  return out;
}

/** `{ types: { name: type }, samples: [{ name, labels, value }] }` o null si no es texto válido. */
function parse(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const types = {};
  const samples = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const t = /^# TYPE ([a-zA-Z_:][a-zA-Z0-9_:]*) (counter|gauge|histogram|summary|untyped)$/.exec(line);
    if (t) {
      types[t[1]] = t[2];
      continue;
    }
    if (line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(\s+\d+)?$/.exec(line);
    if (!m) return null;
    const value = Number(m[3] === "+Inf" ? Infinity : m[3]);
    if (Number.isNaN(value)) return null;
    samples.push({ name: m[1], labels: m[2] ? parseLabels(m[2]) : {}, value });
  }
  return { types, samples };
}

/** Suma de las muestras `name` cuyos labels incluyen `match`. */
const sum = (parsed, name, match = {}) =>
  (parsed ? parsed.samples : []).filter((s) => s.name === name && Object.entries(match).every(([k, v]) => (typeof v === "function" ? v(s.labels[k]) : s.labels[k] === v))).reduce((n, s) => n + s.value, 0);

module.exports = { parse, sum };
