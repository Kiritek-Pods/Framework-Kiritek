"use strict";

/**
 * Validación local de Conventional Commits y sintaxis de clave Jira.
 *
 * Este módulo es PURO: no hace red ni E/S. Recibe el mensaje de commit (y,
 * opcionalmente, el nombre de rama / metadata de PR) y la configuración, y
 * devuelve un `PolicyResult` del contrato compartido (ver domain/result.js).
 *
 * Alcance deliberado (Tarea 22, requisitos 9.1–9.6):
 *  - 22.1 Valida tipos configurables, scope opcional, breaking changes
 *    (`!` y footer `BREAKING CHANGE:`), estructura subject/body/footer y
 *    límites de longitud configurables.
 *  - 22.2 Extrae la clave Jira con una expresión configurable (default estándar)
 *    desde ubicaciones configuradas (commit/branch/pr). Si Jira está
 *    deshabilitado, se OMITE la exigencia de clave SIN desactivar Conventional
 *    Commits ni los controles de secretos (que viven en otros módulos).
 *  - 22.3 Reconoce merge/revert automáticos con política explícita; modela
 *    `NO-JIRA` como excepción limitada por tipo de cambio y razón, nunca como
 *    bypass universal.
 *  - 22.4 El resultado es validación SINTÁCTICA local, NUNCA prueba de
 *    existencia remota (eso es Tarea 23). Se etiqueta explícitamente como
 *    `unverified` / `syntactic`.
 *
 * No valida secretos: eso es responsabilidad del motor de archivos/Gitleaks.
 */

const result = require("../domain/result.js");

const CONTROL_ID = "commits.conventional";
const JIRA_CONTROL_ID = "commits.jira-key";

/** Validación sintáctica local; jamás una afirmación de existencia remota. */
const SYNTACTIC_VALIDATION = "syntactic";
const REMOTE_UNVERIFIED = "unverified";

/** Prefijos de commits automáticos que Git genera con formato propio. */
const MERGE_PREFIX = /^Merge\b/;
const REVERT_PREFIX = /^Revert\b/;

/** Header Conventional Commits: type(scope)!: subject */
const HEADER_RE = /^([a-zA-Z]+)(\(([^()\n]+)\))?(!)?:\s(.+)$/;

const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:\s?.+/m;

function asArray(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

/**
 * Normaliza la configuración de commits a partir de la config efectiva.
 * Acepta `config.commits` o valores sueltos; aplica defaults seguros.
 */
function resolveCommitPolicy(config = {}) {
  const c = (config && config.commits) || {};
  return {
    enabled: c.enabled !== false,
    types: asArray(c.types, [
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
    requireScope: c.requireScope === true,
    maxSubjectLength: Number.isInteger(c.maxSubjectLength) ? c.maxSubjectLength : 72,
    maxBodyLineLength: Number.isInteger(c.maxBodyLineLength) ? c.maxBodyLineLength : 100,
    allowMergeCommits: c.allowMergeCommits !== false,
    allowRevertCommits: c.allowRevertCommits !== false,
  };
}

/**
 * Normaliza la configuración Jira relevante para la validación local.
 */
function resolveJiraPolicy(config = {}) {
  const j = (config && config.jira) || {};
  const noJira = j.noJira || {};
  return {
    enabled: j.enabled === true,
    keyPattern: typeof j.keyPattern === "string" && j.keyPattern.trim() !== "" ? j.keyPattern : "[A-Z][A-Z0-9]+-[0-9]+",
    locations: asArray(j.locations, ["commit", "branch", "pr"]),
    noJira: {
      token: typeof noJira.token === "string" && noJira.token.trim() !== "" ? noJira.token : "NO-JIRA",
      allowedTypes: Array.isArray(noJira.allowedTypes) ? noJira.allowedTypes : [],
      requireReason: noJira.requireReason !== false,
    },
  };
}

/**
 * Separa el mensaje de commit en header / body / footer, ignorando comentarios
 * (`#`) y la línea de tijeras de `--verbose`.
 */
function parseMessage(raw) {
  const text = typeof raw === "string" ? raw : "";
  // Cortar en la línea de scissors de git commit --verbose.
  const scissors = text.indexOf("# ------------------------ >8 ------------------------");
  const trimmed = scissors === -1 ? text : text.slice(0, scissors);

  const lines = trimmed.split(/\r?\n/).filter((l) => !/^\s*#/.test(l));
  // Quitar líneas en blanco al final.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const header = lines.length > 0 ? lines[0] : "";
  const rest = lines.slice(1);
  // El body empieza tras la primera línea en blanco.
  let bodyLines = rest;
  if (rest.length > 0 && rest[0].trim() === "") bodyLines = rest.slice(1);

  return { header, body: bodyLines.join("\n"), allLines: lines, raw: trimmed };
}

/**
 * ¿Es un commit automático de merge o revert?
 */
function classifyAutomatic(header) {
  if (MERGE_PREFIX.test(header)) return "merge";
  if (REVERT_PREFIX.test(header)) return "revert";
  return null;
}

/**
 * Compila el patrón Jira a RegExp global, de forma defensiva.
 */
function compileJiraPattern(pattern) {
  try {
    return new RegExp(pattern, "g");
  } catch (_) {
    // Patrón inválido: no revienta la validación; devolvemos null y el control
    // lo reporta como error de configuración.
    return null;
  }
}

/**
 * Extrae claves Jira (sintácticas) de las ubicaciones configuradas.
 *
 * @param {object} input   { message, branch, pr }
 * @param {object} jira     política Jira resuelta
 * @returns {{ keys: string[], byLocation: object, patternValid: boolean }}
 */
function extractJiraKeys(input, jira) {
  const re = compileJiraPattern(jira.keyPattern);
  const byLocation = {};
  const keys = new Set();
  if (!re) return { keys: [], byLocation, patternValid: false };

  const sources = {
    commit: typeof input.message === "string" ? input.message : "",
    branch: typeof input.branch === "string" ? input.branch : "",
    pr: typeof input.pr === "string" ? input.pr : "",
  };

  for (const loc of jira.locations) {
    const src = sources[loc];
    if (!src) continue;
    re.lastIndex = 0;
    const found = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      found.push(m[0]);
      keys.add(m[0]);
      if (m.index === re.lastIndex) re.lastIndex += 1; // evita loop con zero-width
    }
    if (found.length > 0) byLocation[loc] = found;
  }

  return { keys: [...keys], byLocation, patternValid: true };
}

/**
 * Detecta un marcador `NO-JIRA` gobernado en el mensaje y extrae su razón.
 * Formato esperado (footer): `NO-JIRA: <razón>`.
 *
 * @returns {{ present: boolean, reason: string|null }}
 */
function extractNoJira(message, token) {
  const safeToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${safeToken}:\\s?(.*)$`, "mi");
  const m = re.exec(typeof message === "string" ? message : "");
  if (!m) return { present: false, reason: null };
  const reason = (m[1] || "").trim();
  return { present: true, reason: reason === "" ? null : reason };
}

/**
 * Valida el header Conventional Commits y la estructura.
 *
 * @returns {{ findings: Array<{rule,msg}>, type: string|null, breaking: boolean }}
 */
function validateConventional(parsed, policy) {
  const findings = [];
  const header = parsed.header;

  if (header.trim() === "") {
    findings.push({ rule: "empty-header", msg: "el mensaje de commit está vacío" });
    return { findings, type: null, breaking: false };
  }

  const match = HEADER_RE.exec(header);
  if (!match) {
    findings.push({
      rule: "header-format",
      msg: "el header no cumple Conventional Commits (type(scope)!: subject)",
    });
    return { findings, type: null, breaking: false };
  }

  const type = match[1];
  const scope = match[3];
  const bang = match[4] === "!";
  const subject = match[5];

  if (!policy.types.includes(type)) {
    findings.push({ rule: "unknown-type", msg: `tipo no permitido: ${type} (permitidos: ${policy.types.join(", ")})` });
  }
  if (policy.requireScope && !scope) {
    findings.push({ rule: "missing-scope", msg: "la política exige scope: type(scope): subject" });
  }
  if (scope !== undefined && scope.trim() === "") {
    findings.push({ rule: "empty-scope", msg: "el scope entre paréntesis no puede estar vacío" });
  }
  if (header.length > policy.maxSubjectLength) {
    findings.push({
      rule: "subject-too-long",
      msg: `el header excede ${policy.maxSubjectLength} caracteres (${header.length})`,
    });
  }
  if (subject && /^\s/.test(subject)) {
    findings.push({ rule: "subject-leading-space", msg: "el subject tiene espacios iniciales sobrantes" });
  }

  // Body: línea en blanco obligatoria entre header y body si hay body.
  if (parsed.allLines.length > 1 && parsed.allLines[1].trim() !== "") {
    findings.push({ rule: "missing-blank-line", msg: "debe haber una línea en blanco entre el header y el body" });
  }
  // Longitud de líneas del body.
  if (parsed.body) {
    const over = parsed.body.split(/\r?\n/).some((l) => l.length > policy.maxBodyLineLength);
    if (over) {
      findings.push({ rule: "body-line-too-long", msg: `alguna línea del body excede ${policy.maxBodyLineLength} caracteres` });
    }
  }

  const breaking = bang || BREAKING_FOOTER_RE.test(parsed.raw);

  return { findings, type, breaking };
}

/**
 * Evalúa un mensaje de commit completo.
 *
 * @param {object} input
 * @param {string} input.message   Mensaje de commit crudo.
 * @param {string} [input.branch]  Nombre de rama (para extraer clave Jira).
 * @param {string} [input.pr]      Metadata/título de PR (para extraer clave).
 * @param {string} input.mode      "warning" | "enforce".
 * @param {object} [input.config]  Config efectiva (usa .commits y .jira).
 * @param {object} [input.actor]   { role } del autor, para gobernar NO-JIRA.
 * @returns {object} PolicyResult extendido con `meta` no sensible.
 */
function evaluateCommit(input) {
  const mode = input.mode === "enforce" ? "enforce" : "warning";
  const config = input.config || {};
  const commitPolicy = resolveCommitPolicy(config);
  const jiraPolicy = resolveJiraPolicy(config);

  const parsed = parseMessage(input.message);
  const automatic = classifyAutomatic(parsed.header);

  const violations = [];
  const meta = {
    validation: SYNTACTIC_VALIDATION,
    remoteVerification: REMOTE_UNVERIFIED, // nunca prueba de existencia (22.4)
    automatic: automatic || null,
    breaking: false,
    type: null,
    jira: { enabled: jiraPolicy.enabled, keys: [], byLocation: {}, required: false, satisfied: null, noJira: null },
  };

  // --- Commits automáticos (merge/revert) ---
  if (automatic === "merge") {
    if (!commitPolicy.allowMergeCommits) {
      violations.push({ rule: "merge-not-allowed", msg: "los commits de merge automáticos no están permitidos por política" });
    }
    // Un merge permitido no pasa por Conventional Commits ni exige clave Jira.
    if (commitPolicy.allowMergeCommits) {
      return finalize({ violations, mode, meta, scope: "commit" });
    }
  } else if (automatic === "revert") {
    if (!commitPolicy.allowRevertCommits) {
      violations.push({ rule: "revert-not-allowed", msg: "los commits de revert automáticos no están permitidos por política" });
    }
    if (commitPolicy.allowRevertCommits) {
      return finalize({ violations, mode, meta, scope: "commit" });
    }
  }

  // --- Conventional Commits (22.1) ---
  if (commitPolicy.enabled) {
    const cc = validateConventional(parsed, commitPolicy);
    meta.type = cc.type;
    meta.breaking = cc.breaking;
    for (const f of cc.findings) violations.push(f);
  }

  // --- Clave Jira sintáctica (22.2–22.4) ---
  // Si Jira está deshabilitado se OMITE la exigencia de clave, pero NO se
  // desactiva lo anterior ni los controles de secretos (que viven aparte).
  if (jiraPolicy.enabled) {
    meta.jira.required = true;
    const extracted = extractJiraKeys(input, jiraPolicy);
    meta.jira.keys = extracted.keys;
    meta.jira.byLocation = extracted.byLocation;

    if (!extracted.patternValid) {
      violations.push({ rule: "jira-pattern-invalid", msg: "jira.keyPattern no es una expresión válida" });
    } else if (extracted.keys.length > 0) {
      meta.jira.satisfied = true;
    } else {
      // Sin clave: ¿hay una excepción NO-JIRA gobernada y autorizada?
      const noJira = evaluateNoJira(parsed, meta.type, jiraPolicy, input.actor);
      meta.jira.noJira = noJira.detail;
      if (noJira.authorized) {
        meta.jira.satisfied = true;
      } else {
        meta.jira.satisfied = false;
        violations.push({ rule: "jira-key-missing", msg: noJira.message });
      }
    }
  }

  return finalize({ violations, mode, meta, scope: "commit" });
}

/**
 * Decide si una excepción NO-JIRA es válida y autorizada.
 * Nunca es un bypass universal: se limita por tipo de cambio permitido y, si la
 * política lo exige, por una razón presente. El rol se tiene en cuenta cuando
 * el adaptador lo provee.
 *
 * @returns {{ authorized: boolean, message: string, detail: object|null }}
 */
function evaluateNoJira(parsed, type, jiraPolicy, actor) {
  const nj = extractNoJira(parsed.raw, jiraPolicy.noJira.token);
  if (!nj.present) {
    return {
      authorized: false,
      message: "falta la clave Jira en las ubicaciones configuradas (commit/branch/pr)",
      detail: null,
    };
  }

  const reasons = [];
  const allowedTypes = jiraPolicy.noJira.allowedTypes;
  const typeAllowed = allowedTypes.length === 0 ? false : type !== null && allowedTypes.includes(type);
  if (!typeAllowed) {
    reasons.push(
      allowedTypes.length === 0
        ? `${jiraPolicy.noJira.token} no está autorizado por política (allowedTypes vacío)`
        : `${jiraPolicy.noJira.token} sólo se permite para tipos ${allowedTypes.join(", ")}`
    );
  }
  if (jiraPolicy.noJira.requireReason && !nj.reason) {
    reasons.push(`${jiraPolicy.noJira.token} exige una razón: usa "${jiraPolicy.noJira.token}: <razón>"`);
  }

  const detail = {
    token: jiraPolicy.noJira.token,
    type: type || null,
    hasReason: !!nj.reason,
    role: actor && typeof actor.role === "string" ? actor.role : null,
    authorized: reasons.length === 0,
  };

  if (reasons.length > 0) {
    return { authorized: false, message: reasons.join("; "), detail };
  }
  return { authorized: true, message: "", detail };
}

/**
 * Construye el PolicyResult final a partir de las violaciones acumuladas.
 */
function finalize({ violations, mode, meta, scope }) {
  if (violations.length === 0) {
    const res = result.createResult({
      controlId: CONTROL_ID,
      decision: result.DECISION.ALLOW,
      toolStatus: result.TOOL_STATUS.NOT_APPLICABLE,
      scope,
    });
    return attachMeta(res, meta);
  }

  const decision = mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;
  // El control que domina es Conventional Commits; si sólo hay violaciones de
  // Jira, se reporta bajo el control de clave Jira.
  const onlyJira = violations.every((v) => v.rule.startsWith("jira"));
  const controlId = onlyJira ? JIRA_CONTROL_ID : CONTROL_ID;

  const reason = violations.map((v) => v.msg).join("; ");
  const res = result.createResult({
    controlId,
    decision,
    toolStatus: result.TOOL_STATUS.OK,
    reason,
    remediation:
      "Corrige el mensaje: usa Conventional Commits (type(scope): subject). " +
      "La validación de clave Jira es sintáctica (unverified); no confirma existencia remota.",
    scope,
  });
  return attachMeta(res, meta);
}

/**
 * Adjunta metadata NO sensible al resultado. El PolicyResult es inmutable, así
 * que devolvemos un objeto nuevo con `meta`. `meta` no contiene valores
 * sensibles: sólo tipo, claves Jira sintácticas y banderas.
 */
function attachMeta(res, meta) {
  return Object.freeze({ ...res, meta: Object.freeze(deepFreeze(meta)) });
}

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
    Object.freeze(obj);
  }
  return obj;
}

module.exports = {
  CONTROL_ID,
  JIRA_CONTROL_ID,
  SYNTACTIC_VALIDATION,
  REMOTE_UNVERIFIED,
  resolveCommitPolicy,
  resolveJiraPolicy,
  parseMessage,
  classifyAutomatic,
  extractJiraKeys,
  extractNoJira,
  validateConventional,
  evaluateNoJira,
  evaluateCommit,
};
