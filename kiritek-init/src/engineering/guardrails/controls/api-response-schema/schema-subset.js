"use strict";

/**
 * Subconjunto de JSON Schema que el control sabe verificar (el del validador
 * del repo) y búsqueda de campos no declarados. Una palabra clave fuera del
 * subconjunto haría pasar respuestas sin verificarlas, por eso el contrato
 * que la use es incoherente (`contract-schema-unsupported`).
 */

const CHECKED = new Set(["type", "const", "enum", "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "items", "minItems", "maxItems", "uniqueItems", "required", "properties", "additionalProperties", "minProperties", "propertyNames", "anyOf", "$ref"]);
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "definitions", "$defs", "examples", "default", "format", "deprecated", "readOnly", "writeOnly", "$comment"]);

/** Palabras clave no soportadas o $ref no locales, como lista de rutas (vacía si todo se verifica). */
function unsupported(schema, at = "$") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const out = [];
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$ref") {
      if (typeof v !== "string" || !v.startsWith("#/")) out.push(`${at}.$ref`);
    } else if (!CHECKED.has(k) && !ANNOTATIONS.has(k)) out.push(`${at}.${k}`);
  }
  for (const [k, v] of Object.entries(schema.properties || {})) out.push(...unsupported(v, `${at}.properties.${k}`));
  for (const key of ["definitions", "$defs"]) for (const [k, v] of Object.entries(schema[key] || {})) out.push(...unsupported(v, `${at}.${key}.${k}`));
  if (schema.items) out.push(...unsupported(schema.items, `${at}.items`));
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") out.push(...unsupported(schema.additionalProperties, `${at}.additionalProperties`));
  for (const [i, s] of (schema.anyOf || []).entries()) out.push(...unsupported(s, `${at}.anyOf[${i}]`));
  return out;
}

function deref(schema, root) {
  let s = schema;
  for (let guard = 0; s && s.$ref && guard < 20; guard += 1) {
    s = s.$ref
      .slice(2)
      .split("/")
      .reduce((n, seg) => (n ? n[seg] : undefined), root);
  }
  return s;
}

/** Cantidad de campos presentes en `value` que el schema no declara (sigue properties, items y $ref locales). */
function undeclared(value, schema, root = schema) {
  const s = deref(schema, root);
  if (!s || typeof s !== "object") return 0;
  if (Array.isArray(value)) return s.items ? value.reduce((n, v) => n + undeclared(v, s.items, root), 0) : 0;
  if (!value || typeof value !== "object") return 0;
  if (s.anyOf) return Math.min(...s.anyOf.map((alt) => undeclared(value, alt, root)));
  const props = s.properties || {};
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (props[k]) n += undeclared(v, props[k], root);
    else if (s.additionalProperties && typeof s.additionalProperties === "object") n += undeclared(v, s.additionalProperties, root);
    else if (s.additionalProperties !== true) n += 1;
  }
  return n;
}

module.exports = { unsupported, undeclared };
