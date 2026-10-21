"use strict";

/**
 * Registro de providers y punto de entrada para generar planes.
 *
 * Este módulo es el ÚNICO lugar que conoce a ambos packs; cada pack (github,
 * codecommit) es independiente y no se referencia entre sí. El core de
 * instalación NO depende de este registro: instalar el core no instala ningún
 * provider (aislamiento, 16.8/17.1).
 *
 * `createPlan` resuelve el generador por nombre, lo ejecuta (dry-run puro, sin
 * red) y envuelve su salida en el contrato base para producir un plan completo,
 * determinista y schema-válido.
 */

const base = require("./base.js");
const github = require("./github.js");
const codecommit = require("./codecommit.js");

/** Nombre de provider → generador. Aislados: ninguno importa al otro. */
const GENERATORS = Object.freeze({
  github,
  "aws-codecommit": codecommit,
});

/** Lista de providers soportados (coincide con base.PROVIDERS). */
const SUPPORTED = Object.freeze(Object.keys(GENERATORS));

/**
 * Genera un plan completo para un provider.
 *
 * @param {string} name  "github" | "aws-codecommit"
 * @param {object} input { env, config }
 * @param {object} deps  { clock, idGenerator } — obligatorios (determinismo).
 * @returns {object} plan congelado, schema-válido (provider-plan.schema.json)
 * @throws {Error} code UNKNOWN_PROVIDER si el nombre no está soportado.
 */
function createPlan(name, input = {}, deps = {}) {
  const generator = GENERATORS[name];
  if (!generator) {
    const err = new Error(`provider desconocido: ${name}`);
    err.code = "UNKNOWN_PROVIDER";
    throw err;
  }
  const partial = generator.generate(input);
  // Blindaje de aislamiento: el generador no puede reclamar otro provider.
  if (partial.provider !== name) {
    const err = new Error(
      `el generador de "${name}" devolvió provider "${partial.provider}" (aislamiento violado)`
    );
    err.code = "PROVIDER_ISOLATION_VIOLATION";
    throw err;
  }
  return base.buildPlan(partial, deps);
}

module.exports = {
  SUPPORTED,
  GENERATORS,
  createPlan,
};
