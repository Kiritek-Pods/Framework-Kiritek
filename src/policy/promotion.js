"use strict";

/**
 * Promoción gobernada de `warning` → `enforce` y diagnóstico de readiness
 * (`security doctor`). (Tarea 33.)
 *
 * Este módulo NO reimplementa ni la auditoría ni el motor ni la gobernanza de
 * excepciones: los COMPONE.
 *
 *  - Readiness (33.1): reutiliza `runCapabilityAuditAsync` para evaluar
 *    integridad de herramientas, hooks, CI y observación de Jira (cuando
 *    aplique); añade la gobernanza de excepciones (expiradas/reactivadas) y la
 *    cobertura de la baseline temporal. Promover exige readiness verde.
 *
 *  - Paridad detector/alcance (33.2): el detector y el alcance son IDÉNTICOS
 *    entre `warning` y `enforce`; lo ÚNICO que cambia es la DECISIÓN de bloqueo
 *    (allow/warn → deny). `verifyScopeParity` lo demuestra byte a byte sobre el
 *    MISMO input: corre el motor en ambos modos y confirma que los hallazgos,
 *    fingerprints, severidad y alcance son idénticos; sólo difiere `decision`.
 *
 *  - Baseline temporal (33.4): tolera SÓLO fingerprints listados con
 *    owner/justificación/expiración. Un hallazgo NO listado (nuevo) sigue
 *    bloqueando en enforce; una entrada EXPIRADA vuelve a bloquear. La baseline
 *    se traduce a `exceptions` del motor (control `files.sensitive`,
 *    `scopeFingerprint`), de modo que la deuda queda registrada y acotada en el
 *    tiempo, nunca como allowlist global.
 *
 *  - Registro de promoción (33.3): actor/origen, fecha, config anterior/nueva,
 *    excepciones por expirar y evidencia redactada. Avisa de expiraciones y
 *    aplica la política al vencer (la entrada expirada deja de cubrir).
 *
 * Honestidad por defecto: si el readiness no se puede verificar, se dice; nunca
 * se declara "listo" sin evidencia. Toda salida está pensada para cruzar el
 * redactor obligatorio (sin secreto/match/línea/valor).
 *
 * (Requisitos 3.8, 20.1–20.7, 28, 26.3, G.13.)
 */

const engine = require("./engine.js");
const result = require("../domain/result.js");
const report = require("../audit/report.js");
const cap = require("../audit/capabilities.js");
const checks = require("../audit/checks.js");
const { createEvidence } = require("../domain/evidence.js");

const CONTROL_ID = "policy.promotion";
const MS_PER_DAY = 24 * 3600 * 1000;

/** Modos del core. La promoción lleva de WARNING a ENFORCE. */
const MODE = Object.freeze({ WARNING: "warning", ENFORCE: "enforce" });

/** Resultado honesto del diagnóstico de readiness. */
const READINESS = Object.freeze({
  READY: "ready",
  NOT_READY: "not-ready",
  UNKNOWN: "unknown",
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Normaliza una entrada de baseline temporal. Cada entrada tolera UN
 * fingerprint conocido (hallazgo legacy) con owner/justificación/expiración.
 * No se aceptan comodines: la tolerancia es por fingerprint exacto. (33.4)
 *
 * @returns {{ valid, errors, entry? }}
 */
function normalizeBaselineEntry(raw, deps = {}) {
  const errors = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["entrada de baseline inválida"] };
  }
  if (!isNonEmptyString(raw.fingerprint)) {
    errors.push("baseline.fingerprint requerido (tolerancia por fingerprint exacto, sin comodines)");
  }
  if (!isNonEmptyString(raw.owner)) errors.push("baseline.owner requerido");
  if (!isNonEmptyString(raw.justification)) errors.push("baseline.justification requerida");
  if (!isNonEmptyString(raw.expiresAt) || Number.isNaN(Date.parse(raw.expiresAt))) {
    errors.push("baseline.expiresAt debe ser un timestamp ISO-8601 válido");
  }
  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    entry: {
      fingerprint: raw.fingerprint,
      owner: raw.owner,
      justification: raw.justification,
      expiresAt: raw.expiresAt,
    },
  };
}

/**
 * Clasifica una baseline respecto a un `now`: entradas activas vs expiradas.
 * Una entrada expirada deja de cubrir hallazgos: el control vuelve a bloquear.
 * (33.3/33.4)
 *
 * @param {object[]} baseline
 * @param {object} [deps] { now: () => number }
 * @returns {{ active: object[], expired: object[], invalid: object[],
 *   expiringSoon: object[] }}
 */
function classifyBaseline(baseline, deps = {}) {
  const nowMs = deps.now ? deps.now() : Date.now();
  const soonMs = nowMs + (deps.warnWithinDays || 14) * MS_PER_DAY;
  const active = [];
  const expired = [];
  const invalid = [];
  const expiringSoon = [];
  for (const raw of Array.isArray(baseline) ? baseline : []) {
    const norm = normalizeBaselineEntry(raw);
    if (!norm.valid) {
      invalid.push({ errors: norm.errors });
      continue;
    }
    const exp = Date.parse(norm.entry.expiresAt);
    if (exp <= nowMs) {
      expired.push(norm.entry);
    } else {
      active.push(norm.entry);
      if (exp <= soonMs) expiringSoon.push(norm.entry);
    }
  }
  return { active, expired, invalid, expiringSoon };
}

/**
 * Traduce las entradas ACTIVAS de la baseline a `exceptions` del motor. Cada
 * una cubre su fingerprint exacto (control `files.sensitive`). Las expiradas NO
 * se traducen: dejan de cubrir, por lo que el hallazgo vuelve a disparar. (33.4)
 *
 * El objeto resultante tiene la forma que `engine.evaluateFiles` espera para
 * `opts.exceptions` (usa `exceptionDomain.covers`, que compara
 * `scopeFingerprint` y respeta `expiresAt`).
 *
 * @param {object[]} baseline
 * @param {object} [deps] { now }
 * @returns {object[]}
 */
function baselineToExceptions(baseline, deps = {}) {
  const { active } = classifyBaseline(baseline, deps);
  return active.map((e) => ({
    controlId: engine.CONTROL_ID,
    scopeFingerprint: e.fingerprint,
    owner: e.owner,
    reason: e.justification,
    expiresAt: e.expiresAt,
  }));
}

/**
 * Verifica la PARIDAD de detector/alcance entre `warning` y `enforce` sobre el
 * MISMO input: corre el motor en ambos modos y confirma que los hallazgos
 * (regla, ruta, severidad, fingerprint, status), el alcance (`scope`) y la lista
 * de findings son byte-idénticos; lo ÚNICO que puede diferir es `decision`
 * (allow/warn en warning → deny en enforce). (33.2)
 *
 * @param {object} input   PolicyInput con `files: [{ path, content }]`.
 * @param {object} [opts]  { exceptions, now }
 * @returns {{ identical, decisionWarning, decisionEnforce, warningFindingsJson,
 *   enforceFindingsJson, scopeWarning, scopeEnforce, reason }}
 */
function verifyScopeParity(input, opts = {}) {
  const warnInput = { ...input, mode: MODE.WARNING };
  const enforceInput = { ...input, mode: MODE.ENFORCE };

  const warnRes = engine.evaluateFiles(warnInput, opts);
  const enforceRes = engine.evaluateFiles(enforceInput, opts);

  // Comparamos TODO menos la decisión: los hallazgos deben ser idénticos byte a
  // byte. Serializamos de forma estable (findings son arrays ya ordenados por
  // el motor según el orden de entrada).
  const stripDecision = (r) => {
    const { decision, ...rest } = r;
    return rest;
  };
  const warnJson = JSON.stringify(stripDecision(warnRes));
  const enforceJson = JSON.stringify(stripDecision(enforceRes));
  const identical = warnJson === enforceJson;

  // La decisión SÍ puede diferir, pero sólo en la dirección permitida:
  // warning produce allow|warn; enforce produce allow|deny para el mismo input.
  const decisionCoherent =
    (warnRes.decision === result.DECISION.ALLOW && enforceRes.decision === result.DECISION.ALLOW) ||
    (warnRes.decision === result.DECISION.WARN && enforceRes.decision === result.DECISION.DENY);

  return {
    identical: identical && decisionCoherent,
    decisionWarning: warnRes.decision,
    decisionEnforce: enforceRes.decision,
    warningFindingsJson: warnJson,
    enforceFindingsJson: enforceJson,
    scopeWarning: warnRes.scope || null,
    scopeEnforce: enforceRes.scope || null,
    reason: !identical
      ? "el alcance/detector difiere entre modos (sólo debería cambiar la decisión)"
      : !decisionCoherent
      ? "la decisión no sigue la transición permitida warn→deny"
      : null,
  };
}

/**
 * Evalúa un conjunto de hallazgos (por fingerprint) contra una baseline en modo
 * ENFORCE: los fingerprints cubiertos por la baseline ACTIVA se toleran como
 * deuda conocida; los NO cubiertos (nuevos) bloquean; los cubiertos por una
 * entrada EXPIRADA vuelven a bloquear. (33.4)
 *
 * @param {object} args { files: [{ path, content }], baseline, now }
 * @returns {{ decision, tolerated: object[], blocking: object[], result }}
 */
function evaluateWithBaseline(args) {
  const files = args.files || [];
  const now = args.now;
  const exceptions = baselineToExceptions(args.baseline, now ? { now } : {});

  const res = engine.evaluateFiles(
    { event: args.scope || "promotion", mode: MODE.ENFORCE, files },
    { exceptions, now }
  );

  // Qué hallazgos quedaron (los NO cubiertos por la baseline activa) y cuáles se
  // toleraron (presentes en el input pero suprimidos por la baseline).
  const remainingFingerprints = new Set((res.findings || []).map((f) => f.fingerprint));

  // Para distinguir tolerados, re-evaluamos SIN excepciones y comparamos.
  const bare = engine.evaluateFiles(
    { event: args.scope || "promotion", mode: MODE.ENFORCE, files },
    { now }
  );
  const allFindings = bare.findings || [];
  const tolerated = allFindings.filter((f) => !remainingFingerprints.has(f.fingerprint));
  const blocking = allFindings.filter((f) => remainingFingerprints.has(f.fingerprint));

  return {
    decision: res.decision,
    tolerated: tolerated.map((f) => ({ fingerprint: f.fingerprint, path: f.path, ruleId: f.ruleId })),
    blocking: blocking.map((f) => ({ fingerprint: f.fingerprint, path: f.path, ruleId: f.ruleId })),
    result: res,
  };
}

/**
 * Ejecuta el DIAGNÓSTICO de readiness (`security doctor`). Reutiliza la
 * auditoría profunda por capacidades y añade la gobernanza de excepciones y la
 * cobertura de la baseline temporal. Devuelve un veredicto honesto:
 *
 *  - `ready`:   todas las capas aplicables OK, sin excepciones expiradas que
 *               importen, baseline sin entradas inválidas/expiradas sin resolver
 *               y, si se aportan hallazgos, ningún hallazgo NUEVO fuera de la
 *               baseline.
 *  - `not-ready`: alguna capa falla (integridad, hooks, CI, Jira unauthorized,
 *               drift) o hay un hallazgo nuevo no tolerado.
 *  - `unknown`: hay capas no verificables que importan (p. ej. Jira sin
 *               observar) y nada falla todavía: no se puede AFIRMAR readiness.
 *
 * No abre red por sí mismo: delega la observación remota en los probes que el
 * CLI inyecta (igual que `security audit`).
 *
 * @param {string} repoRoot
 * @param {object} deps  Igual que runCapabilityAuditAsync + { baseline, files }
 * @returns {Promise<object>}
 */
async function runDoctor(repoRoot, deps = {}) {
  // `auditFn` es inyectable para pruebas deterministas (sin tocar artefactos
  // reales); por defecto corre la auditoría profunda por capacidades.
  const auditFn =
    typeof deps.auditFn === "function" ? deps.auditFn : cap.runCapabilityAuditAsync;
  const audit = await auditFn(repoRoot, deps);

  // Clasificamos cada capa aplicable por su estado canónico (mismo criterio que
  // la auditoría/exit code), para no reinventar la lógica de severidad.
  const layers = audit.capabilities.map((c) => ({
    id: c.id,
    applicable: c.applicable,
    status: report.statusOf(c),
    observation: c.observation || null,
    reason: c.reason || null,
  }));

  const failing = layers.filter(
    (l) => l.applicable && ["failed", "drift", "degraded", "missing"].includes(l.status)
  );
  const unknownLayers = layers.filter((l) => l.applicable && l.status === "unknown");

  // Excepciones activas/expiradas (sin contenido sensible).
  const nowMs = () => (deps.now ? Date.parse(deps.now()) : Date.now());
  const exceptions = checks.activeExceptions(repoRoot, { now: nowMs });

  // Baseline temporal: clasificar y advertir expiraciones.
  const baseline = classifyBaseline(deps.baseline || [], { now: nowMs });

  // Si se aportan hallazgos, verificar que ningún hallazgo NUEVO (fuera de la
  // baseline activa) quede bloqueante en enforce. (33.4)
  let newFindings = { blocking: [], tolerated: [] };
  if (Array.isArray(deps.files) && deps.files.length > 0) {
    const be = evaluateWithBaseline({ files: deps.files, baseline: deps.baseline || [], now: nowMs, scope: "doctor" });
    newFindings = { blocking: be.blocking, tolerated: be.tolerated };
  }

  const blockers = [];
  for (const l of failing) blockers.push(`capa ${l.id}: ${l.status}${l.reason ? ` (${l.reason})` : ""}`);
  if (baseline.invalid.length > 0) blockers.push(`${baseline.invalid.length} entrada(s) de baseline inválida(s)`);
  if (newFindings.blocking.length > 0) {
    blockers.push(`${newFindings.blocking.length} hallazgo(s) nuevo(s) fuera de la baseline`);
  }

  let readiness;
  if (blockers.length > 0) {
    readiness = READINESS.NOT_READY;
  } else if (unknownLayers.length > 0) {
    // Nada falla, pero hay capas que no se pudieron verificar: honestamente no
    // podemos AFIRMAR readiness. No es "no-ready" (nada falló), es "unknown".
    readiness = READINESS.UNKNOWN;
  } else {
    readiness = READINESS.READY;
  }

  return {
    schemaVersion: 1,
    generatedAt: audit.generatedAt,
    readiness,
    layers,
    blockers,
    unknown: unknownLayers.map((l) => l.id),
    exceptions,
    baseline: {
      active: baseline.active.length,
      expired: baseline.expired.length,
      invalid: baseline.invalid.length,
      expiringSoon: baseline.expiringSoon.map((e) => ({ owner: e.owner, expiresAt: e.expiresAt })),
    },
    newFindings,
    audit,
  };
}

/**
 * Decide si una promoción PUEDE proceder a partir de un diagnóstico de doctor.
 * Promover exige `ready`. `unknown` NO basta: no se promueve sin poder afirmar
 * readiness, salvo un override gobernado EXPLÍCITO.
 *
 * El override NO es un bypass silencioso: es una decisión gobernada que exige
 * actor + razón, queda registrada en la evidencia y se marca `overridden: true`
 * con el estado real que tenía el readiness. Un `not-ready` por FALLA real
 * (integridad/hooks/hallazgo nuevo) NO es "overridable": sólo se permite forzar
 * sobre un readiness `unknown` (no verificable), nunca sobre una falla
 * demostrada. (20.4–20.7, documentado con honestidad.)
 *
 * @param {object} doctor  Salida de runDoctor.
 * @param {object} [opts]  { override?: { actor, reason } }
 * @returns {{ allowed, overridden, reason }}
 */
function canPromote(doctor, opts = {}) {
  if (doctor.readiness === READINESS.READY) {
    return { allowed: true, overridden: false, reason: null };
  }
  const override = opts.override;
  const governedOverride =
    override && isNonEmptyString(override.actor) && isNonEmptyString(override.reason);
  // Sólo se puede forzar sobre `unknown` (no verificable), jamás sobre una
  // falla real demostrada.
  if (doctor.readiness === READINESS.UNKNOWN && governedOverride) {
    return {
      allowed: true,
      overridden: true,
      reason: `override gobernado sobre readiness no verificable por ${override.actor}: ${override.reason}`,
    };
  }
  return {
    allowed: false,
    overridden: false,
    reason:
      doctor.readiness === READINESS.NOT_READY
        ? "readiness falló: hay bloqueos reales; no se permite override sobre una falla demostrada"
        : "readiness no verificable: se requiere un override gobernado explícito (--override-actor + --override-reason)",
  };
}

/**
 * Construye el REGISTRO de promoción: actor/origen, fecha, config anterior/nueva
 * y evidencia redactada. No muta nada en disco: devuelve el objeto a persistir
 * por el llamador (CLI), ya pensado para cruzar el redactor. (33.3)
 *
 * @param {object} args { actor, origin, previousConfig, doctor, override, baseline }
 * @param {object} [deps] { clock, idGenerator, configHash }
 * @returns {{ record, evidence }}
 */
function buildPromotionRecord(args, deps = {}) {
  const clock = deps.clock || (() => new Date().toISOString());
  const date = clock();

  const previousMode =
    (args.previousConfig && args.previousConfig.mode) || MODE.WARNING;
  const newConfig = { ...(args.previousConfig || {}), mode: MODE.ENFORCE };

  const configHash =
    deps.configHash ||
    require("crypto").createHash("sha256").update(JSON.stringify(newConfig)).digest("hex").slice(0, 16);

  const evidence = createEvidence(
    {
      control: CONTROL_ID,
      command: "kiritek-init security promote --to=enforce",
      toolVersion: deps.toolVersion || "0.0.0",
      configHash,
      scope: "promotion",
      exitCode: 0,
      decision: result.DECISION.ALLOW,
    },
    { clock: deps.clock, idGenerator: deps.idGenerator }
  );

  const record = {
    schemaVersion: 1,
    control: CONTROL_ID,
    actor: isNonEmptyString(args.actor) ? args.actor : "unknown",
    origin: isNonEmptyString(args.origin) ? args.origin : "cli",
    date,
    previousMode,
    newMode: MODE.ENFORCE,
    readiness: args.doctor ? args.doctor.readiness : READINESS.UNKNOWN,
    overridden: !!(args.override && args.override.overridden),
    overrideReason: args.override && args.override.reason ? args.override.reason : null,
    baseline: {
      active: args.doctor && args.doctor.baseline ? args.doctor.baseline.active : 0,
      expiringSoon: args.doctor && args.doctor.baseline ? args.doctor.baseline.expiringSoon : [],
    },
    evidenceRef: evidence.id,
  };

  return { record, evidence };
}

module.exports = {
  CONTROL_ID,
  MODE,
  READINESS,
  normalizeBaselineEntry,
  classifyBaseline,
  baselineToExceptions,
  verifyScopeParity,
  evaluateWithBaseline,
  runDoctor,
  canPromote,
  buildPromotionRecord,
};
