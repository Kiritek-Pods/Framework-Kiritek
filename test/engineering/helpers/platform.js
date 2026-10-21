"use strict";

// Condiciones de skip con RAZÓN explícita (T16.8). Sólo se omite lo que la
// matriz de compatibilidad declara no soportado en la plataforma actual.
const { platformCapabilities } = require("../../../src/engineering/guardrails/compatibility.js");

const caps = platformCapabilities();
/** Shims de hooks Git/Kiro/Claude son POSIX sh (Windows: subconjunto). */
const POSIX_ONLY = !caps.gitHooks && "shims y hooks POSIX sh no soportados en esta plataforma (compatibility.MATRIX.os)";
/** Ejecutar código de plugins exige el modelo de permisos de Node ≥ 22. */
const NEEDS_SANDBOX = !caps.plugins && "ejecutar plugins requiere Node ≥ 22 (modelo de permisos)";

module.exports = { POSIX_ONLY, NEEDS_SANDBOX };
