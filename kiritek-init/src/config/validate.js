"use strict";

/**
 * Validación de la configuración de seguridad contra su schema.
 * Reutiliza el validador sin dependencias del dominio.
 */

const { validateAgainst } = require("../domain/schema-validator.js");

/**
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  return validateAgainst("config", config);
}

/**
 * Valida y lanza si la configuración no cumple el schema.
 */
function assertValidConfig(config) {
  const res = validateConfig(config);
  if (!res.valid) {
    const err = new Error(`configuración inválida: ${res.errors.join("; ")}`);
    err.code = "CONFIG_INVALID";
    err.errors = res.errors;
    throw err;
  }
  return config;
}

module.exports = { validateConfig, assertValidConfig };
