"use strict";

/**
 * Capa de GOBERNANZA de excepciones (Tarea 31).
 *
 * `domain/exception.js` ya modela el contrato base (control, fingerprint/ruta
 * mínima, razón, owner, ticket, creación, expiración acotada por
 * MAX_EXPIRY_DAYS) y las primitivas `isActive`/`covers`. Esta capa NO
 * reimplementa nada de eso: lo reutiliza y añade las reglas de gobernanza que
 * no viven en el contrato puro:
 *
 *  - Aprobador DISTINTO del autor cuando la excepción toca superficies
 *    sensibles (políticas, workflows, hooks, allowlists, secretos). (28.2)
 *  - Límites de AMPLITUD: no se aceptan excepciones excesivamente amplias
 *    (comodines de ruta, alcance de directorio demasiado abierto). (28.3)
 *  - REACTIVACIÓN: el control vuelve a disparar al expirar la excepción o al
 *    cambiar el fingerprint del hallazgo. (28.4)
 *  - REPORTE redactado: cantidad, edad, owner y estado SIN contenido
 *    sensible. (28.5)
 *  - BREAK-GLASS como un TIPO de excepción gobernada (identidad autorizada,
 *    motivo, ticket/incidente, alcance, expiración y revisión posterior).
 *    NUNCA es `--no-verify` ni "apagar el workflow". (7.5, 28.6, G.5)
 *  - Protección de cambios a política/hook/workflow/allowlist mediante
 *    ownership remoto cuando esté disponible; cuando NO lo esté, se declara la
 *    limitación con honestidad en vez de fingir protección. (17.6, 7.4)
 *
 * El módulo es puro y determinista: no abre red ni asume `main`. El `clock`/
 * `now` es inyectable para pruebas. Toda salida pública se arma pensada para
 * cruzar el redactor obligatorio (no incluye secreto/match/línea).
 *
 * (Requisitos 3.8, 5.5, 7.5, 9.4, 20.5–20.7, 28.1–28.6, G.5.)
 */

const exceptionDomain = require("../domain/exception.js");

/**
 * Superficies cuyo cambio exige revisión de un owner distinto del autor y, a
 * nivel remoto, protección por ownership (CODEOWNERS/revisores). Una excepción
 * sobre uno de estos controles es "sensible". (28.2, 17.6)
 */
const SENSITIVE_CONTROL_PREFIXES = Object.freeze([
  "policy", // cambios de política
  "hook", // hooks de cliente
  "workflow", // workflows CI
  "allowlist", // listas de permitidos
  "secrets", // detección de secretos
  "git", // guardas Git
]);

/** Tipos de excepción gobernada. break-glass es un tipo, NO un bypass. */
const EXCEPTION_TYPE = Object.freeze({
  STANDARD: "standard",
  BREAK_GLASS: "break-glass",
});

/**
 * Mecanismos que JAMÁS son una excepción válida. Si una excepción los declara
 * (en cualquier campo razonable), se rechaza de plano. (28.6, 7.3)
 */
const PROHIBITED_MECHANISMS = Object.freeze([
  "--no-verify",
  "no-verify",
  "disable-workflow",
  "disable_workflow",
  "workflow-disable",
  "skip-ci",
  "skip ci",
  "[skip ci]",
  "edit-report",
  "edit_report",
]);

/**
 * Estados reportables de una excepción (sin contenido sensible). (28.4, 28.5)
 */
const EXCEPTION_STATE = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  REACTIVATED: "reactivated", // expirada o fingerprint cambiado → el control vuelve a disparar
});

const MS_PER_DAY = 24 * 3600 * 1000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * ¿La excepción toca una superficie sensible? Se decide por el prefijo del
 * `controlId` (p. ej. `policy.*`, `secrets.*`, `git.*`).
 */
function isSensitiveControl(controlId) {
  if (!isNonEmptyString(controlId)) return false;
  const head = controlId.split(".")[0].toLowerCase();
  return SENSITIVE_CONTROL_PREFIXES.includes(head);
}

/**
 * Detecta mecanismos prohibidos declarados en la entrada cruda (antes de
 * construir el contrato). Barre los campos textuales relevantes. No muta nada.
 *
 * @returns {string[]} mecanismos prohibidos encontrados (vacío si limpio).
 */
function detectProhibitedMechanisms(input) {
  if (!input || typeof input !== "object") return [];
  const hits = new Set();
  const haystacks = [
    input.mechanism,
    input.bypass,
    input.reason,
    input.scopePath,
    input.motive,
    input.note,
  ].filter(isNonEmptyString);
  for (const text of haystacks) {
    const lowered = text.toLowerCase();
    for (const mech of PROHIBITED_MECHANISMS) {
      if (lowered.includes(mech)) hits.add(mech);
    }
  }
  // Una bandera explícita de "apagar workflow"/"saltar verificación" también
  // es un mecanismo prohibido, independientemente del texto.
  if (input.disableWorkflow === true) hits.add("disable-workflow");
  if (input.noVerify === true) hits.add("no-verify");
  return [...hits];
}

/**
 * ¿La ruta de alcance es excesivamente amplia? Una excepción debe apuntar a un
 * objetivo mínimo: comodines amplios o alcances de "todo el repo"/directorio
 * raíz no son aceptables en enforcement. (28.3)
 *
 * Heurística conservadora y explicable (no mágica):
 *  - Comodín global (`*`, `**`, `.`, `./`, `/`) → amplio.
 *  - Un glob que termina en `/*` o `/**` cubriendo un directorio → amplio.
 *  - Un glob con comodín pero SIN segmento de archivo concreto → amplio.
 */
function isScopeTooBroad(exc) {
  // Un fingerprint exacto nunca es "amplio": apunta a un hallazgo único.
  if (isNonEmptyString(exc.scopeFingerprint)) return false;
  const p = isNonEmptyString(exc.scopePath) ? exc.scopePath.trim() : "";
  if (p === "") return true; // sin objetivo → amplio por definición
  const normalized = p.replace(/\\/g, "/");
  if (["*", "**", ".", "./", "/", "**/*"].includes(normalized)) return true;
  // Directorio entero por comodín al final.
  if (/\/\*\*?$/.test(normalized)) return true;
  // Comodín en cualquier lugar sin extensión/archivo concreto al final.
  if (normalized.includes("*")) {
    const last = normalized.split("/").pop() || "";
    const hasConcreteFile = last !== "" && !last.includes("*") && last.includes(".");
    if (!hasConcreteFile) return true;
  }
  return false;
}

/**
 * Edad en días de una excepción respecto a `now` (entero hacia abajo).
 */
function ageInDays(exc, now) {
  const created = Date.parse(exc.createdAt);
  if (Number.isNaN(created)) return null;
  return Math.max(0, Math.floor((now - created) / MS_PER_DAY));
}

/**
 * Resuelve el ESTADO reportable de una excepción respecto a un `now` y, si se
 * provee, al fingerprint ACTUAL del hallazgo. Si la excepción expiró o el
 * fingerprint cambió, el estado es REACTIVATED: el control vuelve a disparar.
 * (28.4)
 *
 * @param {object} exc
 * @param {object} [opts] { now: () => number, currentFingerprint?: string }
 * @returns {{ state: string, active: boolean, reactivated: boolean, reason?: string }}
 */
function resolveState(exc, opts = {}) {
  const nowMs = opts.now ? opts.now() : Date.now();
  const active = exceptionDomain.isActive(exc, { now: () => nowMs }).active;
  if (!active) {
    return { state: EXCEPTION_STATE.EXPIRED, active: false, reactivated: true, reason: "excepción expirada" };
  }
  // Cambio de fingerprint: si nos dan el fingerprint actual y no coincide con
  // el cubierto, la excepción deja de aplicar → reactivación del hallazgo.
  if (
    isNonEmptyString(opts.currentFingerprint) &&
    isNonEmptyString(exc.scopeFingerprint) &&
    exc.scopeFingerprint !== opts.currentFingerprint
  ) {
    return {
      state: EXCEPTION_STATE.REACTIVATED,
      active: false,
      reactivated: true,
      reason: "el fingerprint del hallazgo cambió; la excepción ya no aplica",
    };
  }
  return { state: EXCEPTION_STATE.ACTIVE, active: true, reactivated: false };
}

/**
 * Valida una excepción BAJO GOBERNANZA. Construye el contrato base vía
 * `domain/exception.js` (que ya exige los campos mínimos y la expiración
 * acotada) y aplica las reglas de gobernanza extra.
 *
 * Reglas de gobernanza:
 *  - Mecanismos prohibidos (`--no-verify`, apagar workflow, editar reporte) →
 *    rechazo inmediato. (28.6)
 *  - Alcance excesivamente amplio → rechazo en enforcement. (28.3)
 *  - Si el control es sensible (política/hook/workflow/allowlist/secretos),
 *    exige `approver` DISTINTO del `owner`/autor. (28.2)
 *  - break-glass: exige los campos de incidente/alcance/expiración/revisión y
 *    SIEMPRE un aprobador distinto; nunca declara un mecanismo prohibido. (7.5)
 *
 * @param {object} input   Excepción cruda (incluye `type`, `approver`, etc.).
 * @param {object} [opts]  { mode?: 'enforce'|'warning', clock?, now? }
 * @returns {{ valid: boolean, errors: string[], exception?: object, type: string }}
 */
function validateException(input, opts = {}) {
  const errors = [];
  const mode = opts.mode === "warning" ? "warning" : "enforce";
  const type = input && input.type === EXCEPTION_TYPE.BREAK_GLASS
    ? EXCEPTION_TYPE.BREAK_GLASS
    : EXCEPTION_TYPE.STANDARD;

  // 1) Mecanismos prohibidos: nunca son excepción válida (fail-closed). (28.6)
  const prohibited = detectProhibitedMechanisms(input);
  if (prohibited.length > 0) {
    errors.push(
      `mecanismo prohibido como excepción: ${prohibited.join(", ")} — una excepción nunca es un bypass`
    );
  }

  // 2) Contrato base: campos mínimos + expiración acotada. (28.1, 28.3)
  let exc = null;
  try {
    exc = exceptionDomain.createException(input, {
      clock: opts.clock,
    });
  } catch (err) {
    errors.push(err.message);
  }

  // Si el contrato base falló, no podemos aplicar el resto con garantías.
  if (!exc) {
    return { valid: false, errors, type };
  }

  // 3) Amplitud. En enforcement es un rechazo; en warning se advierte igual.
  if (isScopeTooBroad(exc)) {
    errors.push("alcance excesivamente amplio: una excepción debe apuntar a un fingerprint o archivo concreto");
  }

  // 4) Aprobador distinto cuando aplique. break-glass SIEMPRE lo exige. (28.2)
  const needsDistinctApprover = type === EXCEPTION_TYPE.BREAK_GLASS || isSensitiveControl(exc.controlId);
  if (needsDistinctApprover) {
    if (!isNonEmptyString(exc.approver)) {
      errors.push(
        "esta excepción toca una superficie sensible y requiere un aprobador (approver) distinto del autor"
      );
    } else if (exc.approver.trim() === exc.owner.trim()) {
      errors.push("el aprobador (approver) debe ser DISTINTO del autor/owner");
    }
  }

  // 5) Campos específicos de break-glass. (7.5)
  if (type === EXCEPTION_TYPE.BREAK_GLASS) {
    if (!isNonEmptyString(input.motive)) {
      errors.push("break-glass requiere un motivo (motive)");
    }
    if (!isNonEmptyString(input.incident) && !isNonEmptyString(exc.ticket)) {
      errors.push("break-glass requiere ticket/incidente");
    }
    // La revisión posterior se declara como compromiso explícito y verificable.
    if (input.postReview !== true && !isNonEmptyString(input.postReviewTicket)) {
      errors.push("break-glass requiere revisión posterior (postReview:true o postReviewTicket)");
    }
  }

  const valid = errors.length === 0;
  return { valid, errors, type, exception: valid ? exc : undefined };
}

/**
 * Construye un REPORTE redactado de una lista de excepciones: por cada entrada,
 * cantidad/edad/owner/estado — SIN contenido sensible (sin razón libre, sin
 * fingerprint que pudiera ser sensible más allá de su presencia). (28.5, 20.5)
 *
 * El reporte está pensado para cruzar `redactor.safeSerialize`.
 *
 * @param {object[]} exceptions
 * @param {object} [opts] { now, currentFingerprints?: Record<index, string> }
 * @returns {{ total, active, expired, reactivated, entries: object[] }}
 */
function reportExceptions(exceptions, opts = {}) {
  const nowMs = opts.now ? opts.now() : Date.now();
  const list = Array.isArray(exceptions) ? exceptions : [];
  const entries = [];
  let active = 0;
  let expired = 0;
  let reactivated = 0;

  list.forEach((exc, index) => {
    if (!exc || typeof exc !== "object") {
      entries.push({ index, state: "invalid", owner: null, ageDays: null });
      return;
    }
    const currentFingerprint =
      opts.currentFingerprints && typeof opts.currentFingerprints === "object"
        ? opts.currentFingerprints[index]
        : undefined;
    const st = resolveState(exc, { now: () => nowMs, currentFingerprint });
    if (st.state === EXCEPTION_STATE.ACTIVE) active += 1;
    else if (st.state === EXCEPTION_STATE.EXPIRED) expired += 1;
    else if (st.state === EXCEPTION_STATE.REACTIVATED) reactivated += 1;

    entries.push({
      index,
      controlId: isNonEmptyString(exc.controlId) ? exc.controlId : null,
      owner: isNonEmptyString(exc.owner) ? exc.owner : null,
      ticket: isNonEmptyString(exc.ticket) ? exc.ticket : null,
      type: exc.type === EXCEPTION_TYPE.BREAK_GLASS ? EXCEPTION_TYPE.BREAK_GLASS : EXCEPTION_TYPE.STANDARD,
      state: st.state,
      active: st.active,
      ageDays: ageInDays(exc, nowMs),
      // Presencia (no valor) de alcance: útil para auditar sin exponer datos.
      hasFingerprint: isNonEmptyString(exc.scopeFingerprint),
      hasPath: isNonEmptyString(exc.scopePath),
    });
  });

  return { total: list.length, active, expired, reactivated, entries };
}

/**
 * Evalúa la PROTECCIÓN por ownership remoto para cambios a superficies
 * sensibles (política/hook/workflow/allowlist). Lee CODEOWNERS si existe;
 * cuando NO hay fuente de ownership del proveedor, DECLARA la limitación con
 * honestidad en vez de afirmar protección. (17.6, 7.4, 17.7)
 *
 * No abre red: sólo inspecciona fuentes locales conocidas de ownership
 * (CODEOWNERS). La observación/aplicación remota real vive en los packs de
 * proveedor (tareas 38–41); aquí distinguimos `protected` / `unprotected` /
 * `unknown` de forma honesta.
 *
 * @param {object} args { repoRoot, readFile?, exists?, path? }  (fs inyectable)
 * @returns {{ supported: boolean, protected: boolean, source: string|null, reason: string }}
 */
function assessRemoteOwnership(args = {}) {
  const repoRoot = args.repoRoot || process.cwd();
  const fsMod = args.fs || require("fs");
  const pathMod = args.path || require("path");

  // Ubicaciones estándar de CODEOWNERS (GitHub/GitLab).
  const candidates = [
    pathMod.join(repoRoot, "CODEOWNERS"),
    pathMod.join(repoRoot, ".github", "CODEOWNERS"),
    pathMod.join(repoRoot, "docs", "CODEOWNERS"),
    pathMod.join(repoRoot, ".gitlab", "CODEOWNERS"),
  ];

  let codeownersPath = null;
  for (const c of candidates) {
    try {
      if (fsMod.existsSync(c)) {
        codeownersPath = c;
        break;
      }
    } catch (_) {
      /* ignorar y seguir con el siguiente candidato */
    }
  }

  if (!codeownersPath) {
    // Honestidad: sin fuente de ownership NO afirmamos protección. (7.4, 17.7)
    return {
      supported: false,
      protected: false,
      source: null,
      reason:
        "no se encontró CODEOWNERS ni una fuente de ownership del proveedor; no se puede afirmar protección remota (hooks cliente son evadibles)",
    };
  }

  let content = "";
  try {
    content = fsMod.readFileSync(codeownersPath, "utf8");
  } catch (err) {
    return {
      supported: true,
      protected: false,
      source: codeownersPath,
      reason: `CODEOWNERS presente pero ilegible (${err.message}); no se puede afirmar protección`,
    };
  }

  // ¿CODEOWNERS cubre superficies sensibles? Buscamos patrones que apunten a
  // política/hooks/workflows/allowlists de seguridad.
  const protectsSensitive = /(\.kiritek|kiritek-security\.config|\.github\/workflows|\.claude|\.kiro|CODEOWNERS)/.test(
    content
  );

  if (!protectsSensitive) {
    return {
      supported: true,
      protected: false,
      source: codeownersPath,
      reason:
        "CODEOWNERS presente pero no cubre política/hooks/workflows/allowlists de seguridad; cobertura insuficiente",
    };
  }

  return {
    supported: true,
    protected: true,
    source: codeownersPath,
    reason: "CODEOWNERS cubre superficies sensibles; los cambios requieren revisión de propietarios",
  };
}

module.exports = {
  EXCEPTION_TYPE,
  EXCEPTION_STATE,
  SENSITIVE_CONTROL_PREFIXES,
  PROHIBITED_MECHANISMS,
  isSensitiveControl,
  detectProhibitedMechanisms,
  isScopeTooBroad,
  resolveState,
  ageInDays,
  validateException,
  reportExceptions,
  assessRemoteOwnership,
};
