"use strict";

/**
 * Minimización por schema (T08.1; design §19, paso 1).
 *
 * Conserva sólo las propiedades declaradas en el schema de salida (siguiendo
 * $ref, items, anyOf y additionalProperties). Lo no declarado se descarta
 * antes de cualquier otra etapa: lo que no está en el contrato no se publica.
 */

const { loadSchema } = require("../../../domain/schema-validator.js");

function resolve(schema, root) {
  let s = schema;
  let r = root;
  while (s && s.$ref) {
    const [file, frag = ""] = s.$ref.split("#");
    if (file) r = loadSchema(file.replace(/\.schema\.json$/, ""));
    s = frag ? frag.slice(1).split("/").reduce((acc, k) => acc[k], r) : r;
  }
  return { schema: s, root: r };
}

function typeMatches(value, schema) {
  if (!schema.type) return true;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  return types.some((t) => t === actual || (t === "number" && actual === "integer"));
}

function pick(value, schemaIn, rootIn) {
  const { schema, root } = resolve(schemaIn, rootIn);
  if (!schema) return value;
  if (Array.isArray(schema.anyOf)) {
    for (const alt of schema.anyOf) {
      const r = resolve(alt, root);
      if (typeMatches(value, r.schema)) return pick(value, r.schema, r.root);
    }
    return value;
  }
  if (Array.isArray(value)) return schema.items ? value.map((v) => pick(v, schema.items, root)) : value;
  if (value && typeof value === "object") {
    const out = {};
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) out[k] = pick(v, props[k], root);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") out[k] = pick(v, schema.additionalProperties, root);
      else if (schema.additionalProperties === undefined && !schema.properties) out[k] = v; // objeto libre (p. ej. facts)
    }
    return out;
  }
  return value;
}

/** @param {string} schemaName  p. ej. "engineering/report" */
function minimizeBySchema(value, schemaName) {
  const root = loadSchema(schemaName);
  return pick(JSON.parse(JSON.stringify(value)), root, root);
}

module.exports = { minimizeBySchema };
