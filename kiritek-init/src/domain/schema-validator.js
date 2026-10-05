"use strict";

/**
 * Validador de JSON Schema sin dependencias externas.
 *
 * Implementa el subconjunto de draft-07 que usan los schemas de Kiritek:
 * type, const, enum, required, properties, additionalProperties, items,
 * minLength, minimum, exclusiveMinimum, anyOf, $ref local (#/definitions/...).
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

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) {
    throw new Error(`$ref no soportado (sólo locales '#/...'): ${ref}`);
  }
  const segments = ref.slice(2).split("/");
  let node = root;
  for (const seg of segments) {
    node = node && node[seg];
    if (node === undefined) throw new Error(`$ref no resuelto: ${ref}`);
  }
  return node;
}

function validateNode(value, schema, root, pointer, errors) {
  if (schema.$ref) {
    return validateNode(value, resolveRef(schema.$ref, root), root, pointer, errors);
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

  if (typeOf(value) === "array" && schema.items) {
    value.forEach((item, i) => validateNode(item, schema.items, root, `${pointer}[${i}]`, errors));
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
        validateNode(propValue, props[key], root, `${pointer}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${pointer}: propiedad no permitida "${key}"`);
      }
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const anyOk = schema.anyOf.some((sub) => {
      const subErrors = [];
      validateNode(value, sub, root, pointer, subErrors);
      return subErrors.length === 0;
    });
    if (!anyOk) {
      errors.push(`${pointer}: no satisface ninguna alternativa de anyOf`);
    }
  }
}

/**
 * Valida `value` contra `schema`.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(value, schema) {
  const errors = [];
  validateNode(value, schema, schema, "$", errors);
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
 * exception | break-glass | provider-plan.
 */
function validateAgainst(name, value) {
  return validate(value, loadSchema(name));
}

module.exports = {
  validate,
  validateAgainst,
  loadSchema,
  SCHEMA_DIR,
};
