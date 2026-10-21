"use strict";

/**
 * Validador de JSON Schema sin dependencias externas.
 *
 * Implementa el subconjunto de draft-07 que usan los schemas de Kiritek:
 * type, const, enum, required, properties, additionalProperties, items,
 * minLength, minimum, exclusiveMinimum, anyOf, $ref local (#/definitions/...).
 *
 * Modo `extended` (opt-in): añade pattern, maxLength, maximum, minItems,
 * maxItems, uniqueItems, minProperties, propertyNames y $ref a otro schema
 * del registro (`engineering/common.schema.json#/definitions/x`). Lo usan los
 * contratos de engineering/guardrails; los schemas de security se validan sin
 * él para no alterar su semántica actual.
 *
 * Se mantiene deliberadamente pequeño y auditable para no incorporar una
 * dependencia nueva (política de supply chain, requisito 24). No pretende
 * cubrir todo draft-07, sólo lo que estos contratos necesitan.
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_DIR = path.join(__dirname, "..", "..", "schemas");

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value; // "number" | "string" | "boolean" | "object"
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
}

function resolvePointer(pointer, root, ref) {
  const segments = pointer === "" ? [] : pointer.slice(1).split("/");
  let node = root;
  for (const seg of segments) {
    node = node && node[seg];
    if (node === undefined) throw new Error(`$ref no resuelto: ${ref}`);
  }
  return node;
}

/** Devuelve `{ schema, root }`: el root cambia al seguir un $ref externo. */
function resolveRef(ref, root, opts) {
  if (ref.startsWith("#/")) {
    return { schema: resolvePointer(ref.slice(1), root, ref), root };
  }
  if (!opts.extended) {
    throw new Error(`$ref no soportado (sólo locales '#/...'): ${ref}`);
  }
  const [file, fragment = ""] = ref.split("#");
  if (!file.endsWith(".schema.json") || file.includes("..") || path.isAbsolute(file)) {
    throw new Error(`$ref externo no permitido: ${ref}`);
  }
  const external = loadSchema(file.slice(0, -".schema.json".length));
  return { schema: resolvePointer(fragment, external, ref), root: external };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateExtended(value, schema, root, pointer, errors, opts) {
  const kind = typeOf(value);
  if (kind === "string") {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${pointer}: string más largo que maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${pointer}: no coincide con pattern ${schema.pattern}`);
    }
  }
  if ((kind === "number" || kind === "integer") && schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${pointer}: número mayor que maximum ${schema.maximum}`);
  }
  if (kind === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pointer}: menos elementos que minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${pointer}: más elementos que maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map(canonical));
      if (seen.size !== value.length) errors.push(`${pointer}: elementos duplicados (uniqueItems)`);
    }
  }
  if (kind === "object") {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${pointer}: menos propiedades que minProperties ${schema.minProperties}`);
    }
    if (schema.propertyNames) {
      for (const key of keys) {
        validateNode(key, schema.propertyNames, root, `${pointer}{${key}}`, errors, opts);
      }
    }
  }
}

function validateNode(value, schema, root, pointer, errors, opts) {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root, opts);
    return validateNode(value, resolved.schema, resolved.root, pointer, errors, opts);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${pointer}: tipo inválido, se esperaba ${types.join("|")} y se recibió ${typeOf(value)}`);
      return; // sin el tipo correcto, el resto de checks no aplica
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    errors.push(`${pointer}: se esperaba const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pointer}: valor fuera de enum (${schema.enum.join(", ")})`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${pointer}: string más corto que minLength ${schema.minLength}`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${pointer}: número menor que minimum ${schema.minimum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${pointer}: número no mayor que exclusiveMinimum ${schema.exclusiveMinimum}`);
    }
  }

  if (opts.extended) validateExtended(value, schema, root, pointer, errors, opts);

  if (typeOf(value) === "array" && schema.items) {
    value.forEach((item, i) => validateNode(item, schema.items, root, `${pointer}[${i}]`, errors, opts));
  }

  if (typeOf(value) === "object") {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(`${pointer}: falta propiedad requerida "${key}"`);
        }
      }
    }
    const props = schema.properties || {};
    for (const [key, propValue] of Object.entries(value)) {
      if (props[key]) {
        validateNode(propValue, props[key], root, `${pointer}.${key}`, errors, opts);
      } else if (schema.additionalProperties === false) {
        errors.push(`${pointer}: propiedad no permitida "${key}"`);
      } else if (opts.extended && schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateNode(propValue, schema.additionalProperties, root, `${pointer}.${key}`, errors, opts);
      }
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const anyOk = schema.anyOf.some((sub) => {
      const subErrors = [];
      validateNode(value, sub, root, pointer, subErrors, opts);
      return subErrors.length === 0;
    });
    if (!anyOk) {
      errors.push(`${pointer}: no satisface ninguna alternativa de anyOf`);
    }
  }
}

/**
 * Valida `value` contra `schema`.
 * @param {object} [options]
 * @param {boolean} [options.extended] Habilita las palabras clave extendidas.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(value, schema, options = {}) {
  const errors = [];
  validateNode(value, schema, schema, "$", errors, { extended: !!options.extended });
  return { valid: errors.length === 0, errors };
}

const schemaCache = new Map();

function loadSchema(name) {
  if (schemaCache.has(name)) return schemaCache.get(name);
  const file = path.join(SCHEMA_DIR, `${name}.schema.json`);
  const schema = JSON.parse(fs.readFileSync(file, "utf8"));
  schemaCache.set(name, schema);
  return schema;
}

/**
 * Valida contra un schema nombrado. El registro es aditivo y por nombre de
 * archivo (`<name>.schema.json`): result | evidence | config | audit |
 * exception | break-glass | provider-plan | engineering/<contrato>.
 */
function validateAgainst(name, value, options) {
  return validate(value, loadSchema(name), options);
}

module.exports = {
  validate,
  validateAgainst,
  loadSchema,
  SCHEMA_DIR,
};
