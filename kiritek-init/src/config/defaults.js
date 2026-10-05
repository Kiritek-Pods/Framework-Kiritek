"use strict";

/**
 * Configuración por defecto del core de seguridad. Es la capa de menor
 * precedencia y define un baseline seguro: modo warning para no romper repos
 * existentes, pero con push directo bloqueado y force denegado por defecto.
 */

const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  mode: "warning",
  defaultBranch: Object.freeze({ explicit: null, remote: "origin" }),
  secrets: Object.freeze({ gitleaksVersion: "8.18.4", historyDepth: "full" }),
  git: Object.freeze({ blockDirectDefaultPush: true, forcePolicy: "deny" }),
  // Conventional Commits locales (validación sintáctica). Es opcional: si no se
  // configura, se usan estos defaults sensatos. `enabled` permite apagar la
  // validación de formato sin tocar los controles de secretos.
  commits: Object.freeze({
    enabled: true,
    types: Object.freeze([
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
    ]),
    requireScope: false,
    maxSubjectLength: 72,
    maxBodyLineLength: 100,
    allowMergeCommits: true,
    allowRevertCommits: true,
  }),
  jira: Object.freeze({
    enabled: false,
    keyPattern: "[A-Z][A-Z0-9]+-[0-9]+",
    unavailable: "fail-closed",
    // Ubicaciones donde se busca la clave (orden = prioridad de reporte).
    locations: Object.freeze(["commit", "branch", "pr"]),
    // Validación remota (Tarea 23). `baseUrl` identifica el tenant; NUNCA
    // contiene credenciales: éstas vienen sólo del entorno/secret store.
    baseUrl: null,
    transport: "rest",
    timeoutMs: 5000,
    rateLimitPerMinute: 60,
    cacheTtlSeconds: 300,
    // Si la validación remota es obligatoria y faltan credenciales, falla
    // (sin imprimir el valor). Por defecto no se exige, para no romper repos
    // que sólo usan validación sintáctica local (Tarea 22).
    requireCredentials: false,
    // `NO-JIRA` es una excepción gobernada, nunca un bypass universal: se
    // limita por tipo de cambio permitido y exige razón; la evidencia la
    // registra el adaptador. Lista vacía => no autorizada por defecto.
    noJira: Object.freeze({
      token: "NO-JIRA",
      allowedTypes: Object.freeze(["chore", "docs", "ci"]),
      requireReason: true,
    }),
  }),
  evidence: Object.freeze({ maxAgeHours: 24, directory: ".kiritek/security" }),
  // Telemetría: APAGADA por defecto. El envío remoto exige doble opt-in
  // explícito (`enabled` y `remote.enabled`), https/TLS, auth, id pseudónimo,
  // timeout, retención y destino documentado (requisitos 13.6–13.7, 25.3).
  // `remote` es null hasta que el proyecto lo configure explícitamente.
  telemetry: Object.freeze({ enabled: false, budgetMs: 5000, remote: null }),
});

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { DEFAULT_CONFIG, clone };
