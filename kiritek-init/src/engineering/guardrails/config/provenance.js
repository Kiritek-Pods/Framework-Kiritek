"use strict";

/**
 * Procedencia por hoja (R2.7, R3.3; T03.3).
 *
 * Cada valor efectivo conserva `{ value, sourceKind, sourceRef,
 * sourceVersion? }`, indexado por JSON Pointer del árbol efectivo. Los
 * reportes se redactan: URLs sin credenciales/query y sin rutas absolutas.
 */

const { createProvenance } = require("../contracts/common.js");

function escapeSegment(seg) {
  return String(seg).replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointer(...segments) {
  return `/${segments.map(escapeSegment).join("/")}`;
}

/** sourceRef estable: `<archivo>#<pointer>`. */
function fileRef(file, ...segments) {
  return `${file}#${pointer(...segments)}`;
}

class ProvenanceRecorder {
  constructor() {
    this.entries = {};
  }

  /** Registra el origen de la hoja `ptr`, validando la forma del Provenance. */
  record(ptr, value, source) {
    const p = createProvenance(source, `provenance ${ptr}`);
    this.entries[ptr] = { value: JSON.parse(JSON.stringify(value)), ...p };
  }

  /** Registra todas las hojas de un objeto (arrays son hoja). */
  recordTree(basePtr, value, source) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) this.record(basePtr, value, source);
      for (const k of keys) this.recordTree(`${basePtr}/${escapeSegment(k)}`, value[k], source);
    } else {
      this.record(basePtr, value, source);
    }
  }

  /** Elimina hojas bajo `basePtr` (cuando una capa superior reemplaza). */
  clearUnder(basePtr) {
    for (const key of Object.keys(this.entries)) {
      if (key === basePtr || key.startsWith(`${basePtr}/`)) delete this.entries[key];
    }
  }

  toJSON() {
    return Object.fromEntries(Object.keys(this.entries).sort().map((k) => [k, this.entries[k]]));
  }
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Quita userinfo, query y fragmento de una URL. */
function redactUrl(text) {
  try {
    const u = new URL(text);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch (err) {
    return "[url-redactada]";
  }
}

function redactValue(value) {
  if (typeof value === "string") {
    if (URL_RE.test(value)) return redactUrl(value);
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return "[ruta-absoluta-redactada]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v)]));
  return value;
}

/**
 * Reporte de origen efectivo redactado, filtrable por unidad.
 * @returns {{pointer, value, sourceKind, sourceRef, sourceVersion?}[]}
 */
function provenanceReport(provenance, { unitId } = {}) {
  const prefix = unitId ? pointer("units", unitId) : null;
  return Object.keys(provenance)
    .filter((k) => !prefix || k.startsWith(`${prefix}/`))
    .sort()
    .map((k) => {
      const e = provenance[k];
      const row = { pointer: k, value: redactValue(e.value), sourceKind: e.sourceKind, sourceRef: e.sourceRef };
      if (e.sourceVersion !== undefined) row.sourceVersion = e.sourceVersion;
      return row;
    });
}

module.exports = { escapeSegment, pointer, fileRef, ProvenanceRecorder, redactUrl, redactValue, provenanceReport };
