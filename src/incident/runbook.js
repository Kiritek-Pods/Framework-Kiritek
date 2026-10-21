"use strict";

/**
 * Runbooks y evidencia de incidentes/rotación del core de seguridad Kiritek.
 *
 * A partir de una clasificación (`classify.js`) produce:
 *  - `buildRunbook`           : pasos de respuesta ordenados y accionables
 *                               (contener → revocar/rotar → evaluar uso →
 *                               eliminar → decidir historial → notificar →
 *                               cerrar), con las limitaciones honestas.
 *  - `historyRewriteChecklist`: checklist GATED (nunca auto-ejecuta) para la
 *                               reescritura de historial (19.4).
 *  - `recordRotationEvidence` : evidencia REDACTADA de rotación/alcance/
 *                               controles (19.5) — jamás el secreto.
 *  - `assessRotationAge`      : umbrales warn/fail por edad de rotación cuando
 *                               la fuente permite observarla; honesto si no.
 *
 * Todo es determinista; el reloj es inyectable. No hay red ni efectos.
 */

const {
  INCIDENT_CLASS,
  EXPOSURE,
  classifyIncident,
} = require("./classify.js");
const { safeSerialize } = require("../scanners/redactor.js");

/** Textos accionables por paso del runbook (19.1). Sin valores sensibles. */
const STEP_GUIDANCE = Object.freeze({
  contain: {
    title: "Contener",
    action:
      "Limita el daño inmediato: restringe el uso de la credencial (deshabilitar/limitar permisos), bloquea el push si aún no salió y evita nuevos commits con el valor.",
  },
  "revoke-rotate": {
    title: "Revocar / rotar",
    action:
      "Revoca la credencial expuesta en el proveedor y emite un reemplazo. Esta es la única acción que invalida el secreto; borrarlo del código NO lo revoca.",
  },
  "assess-usage": {
    title: "Evaluar uso",
    action:
      "Revisa logs/registros del proveedor para estimar si la credencial fue usada mientras estuvo expuesta. Si la fuente no lo permite observar, decláralo como desconocido.",
  },
  "remove-from-code": {
    title: "Eliminar del código",
    action:
      "Elimina la referencia del código y despliega. Mueve el valor a un secret store/variable de entorno; no lo vuelvas a commitear.",
  },
  "decide-history": {
    title: "Decidir tratamiento del historial",
    action:
      "Decide si procede reescribir historial. Es OPCIONAL, coordinado y nunca sustituye la rotación. Usa el checklist gated antes de ejecutar nada.",
  },
  notify: {
    title: "Notificar",
    action:
      "Notifica a las partes afectadas (seguridad/propietarios) sin incluir el valor del secreto; enlaza el reporte redactado.",
  },
  close: {
    title: "Cerrar",
    action:
      "Cierra el incidente conservando evidencia redactada de rotación, alcance y controles preventivos; registra aprendizajes.",
  },
});

/**
 * Pasos del checklist de reescritura de historial (19.4). Cada ítem es un gate
 * que una persona debe confirmar; el sistema NO ejecuta la reescritura.
 */
const HISTORY_REWRITE_CHECKLIST = Object.freeze([
  {
    id: "prior-invalidation",
    title: "Invalidación previa del secreto",
    requirement:
      "La credencial YA fue revocada/rotada antes de tocar el historial. Reescribir sin revocar no protege nada.",
    gate: true,
  },
  {
    id: "coordination",
    title: "Coordinación del equipo",
    requirement:
      "El equipo está avisado y coordinado: la reescritura cambiará los SHAs y romperá los clones existentes.",
    gate: true,
  },
  {
    id: "backup",
    title: "Backup del estado actual",
    requirement:
      "Existe un backup/espejo del repositorio y de las refs antes de reescribir, por si hay que revertir.",
    gate: true,
  },
  {
    id: "enumerate-clones-refs-tags",
    title: "Enumerar clones, refs y tags afectados",
    requirement:
      "Se identificaron clones, forks, ramas, tags y refs que contienen los commits a reescribir y quién debe re-clonar.",
    gate: true,
  },
  {
    id: "execute-rewrite",
    title: "Ejecutar reescritura coordinada",
    requirement:
      "Reescritura ejecutada manualmente por una persona autorizada (p. ej. git filter-repo), fuera de este sistema.",
    gate: true,
  },
  {
    id: "post-verification",
    title: "Verificación posterior",
    requirement:
      "Se verificó que el valor ya no aparece en ninguna ref/tag/clon alcanzable y que la credencial anterior está inválida.",
    gate: true,
  },
]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} debe ser un string no vacío`);
  }
}

/**
 * Construye el runbook accionable a partir de una clasificación o de un input
 * clasificable. Devuelve pasos ordenados con guía, más limitaciones honestas.
 *
 * @param {object} classificationOrInput
 * @returns {object}
 */
function buildRunbook(classificationOrInput) {
  const classification =
    classificationOrInput && Array.isArray(classificationOrInput.steps)
      ? classificationOrInput
      : classifyIncident(classificationOrInput);

  const steps = classification.steps.map((s, index) => {
    const guidance = STEP_GUIDANCE[s.id] || { title: s.id, action: "" };
    return {
      order: index + 1,
      id: s.id,
      title: guidance.title,
      action: guidance.action,
      required: s.required,
    };
  });

  const runbook = {
    incidentClass: classification.incidentClass,
    published: classification.published,
    severity: classification.severity,
    requiresRotation: classification.requiresRotation,
    steps,
    limitations: classification.limitations.slice(),
  };

  if (classification.historyRewriteRelevant) {
    runbook.historyRewrite = historyRewriteChecklist();
  }

  return Object.freeze(runbook);
}

/**
 * Devuelve el checklist gated de reescritura de historial. Marca explícitamente
 * que NO es una acción automática.
 */
function historyRewriteChecklist() {
  return Object.freeze({
    gated: true,
    automatic: false,
    note:
      "Checklist GATED: cada ítem requiere confirmación humana. El sistema no reescribe historial automáticamente.",
    items: HISTORY_REWRITE_CHECKLIST.map((item) => Object.freeze({ ...item, done: false })),
  });
}

/**
 * ¿El checklist de reescritura está completo? (todos los gates confirmados).
 * @param {object} checklist  Resultado de historyRewriteChecklist con `done`.
 * @returns {{ complete: boolean, pending: string[] }}
 */
function isHistoryRewriteComplete(checklist) {
  if (!checklist || !Array.isArray(checklist.items)) {
    return { complete: false, pending: HISTORY_REWRITE_CHECKLIST.map((i) => i.id) };
  }
  const pending = checklist.items.filter((i) => i.done !== true).map((i) => i.id);
  return { complete: pending.length === 0, pending };
}

/**
 * Registra evidencia REDACTADA de rotación/alcance/controles al cerrar un
 * incidente (19.5). Nunca almacena el secreto. El reloj es inyectable.
 *
 * @param {object} input
 * @param {string} input.incidentId   Identificador del incidente.
 * @param {string} input.controlId    Control que detectó el secreto.
 * @param {string} input.scope        Alcance afectado (rama/rango, no sensible).
 * @param {boolean} input.rotated     ¿Se rotó/revocó la credencial?
 * @param {string} [input.rotatedAt]  Timestamp ISO de rotación (si observable).
 * @param {string[]} [input.preventiveControls] Controles reforzados.
 * @param {string} [input.fingerprint] Huella del hallazgo (no revela el valor).
 * @param {object} [deps]
 * @param {() => string} [deps.clock] Fuente de timestamp ISO.
 * @returns {{ json: string, evidence: object }}
 */
function recordRotationEvidence(input, deps = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("recordRotationEvidence requiere un objeto");
  }
  const clock = deps.clock || (() => new Date().toISOString());

  assertNonEmptyString(input.incidentId, "incidentId");
  assertNonEmptyString(input.controlId, "controlId");
  assertNonEmptyString(input.scope, "scope");
  if (typeof input.rotated !== "boolean") {
    throw new TypeError("rotated debe ser booleano");
  }

  const evidence = {
    schemaVersion: 1,
    kind: "rotation-evidence",
    incidentId: input.incidentId,
    controlId: input.controlId,
    scope: input.scope,
    rotated: input.rotated,
    // Honesto: si no se observa la fecha, lo decimos en vez de inventarla.
    rotatedAt: typeof input.rotatedAt === "string" ? input.rotatedAt : null,
    rotationObservable: typeof input.rotatedAt === "string",
    preventiveControls: Array.isArray(input.preventiveControls)
      ? input.preventiveControls.slice()
      : [],
    recordedAt: clock(),
  };
  if (typeof input.fingerprint === "string") evidence.fingerprint = input.fingerprint;

  // Fail-closed: la evidencia cruza el redactor; si algo deja un canario, lanza.
  const { json, redacted } = safeSerialize(evidence);
  return { json, evidence: redacted };
}

/**
 * Evalúa la edad de rotación de una credencial administrada contra umbrales
 * configurables (19.6). Devuelve warn/fail SÓLO cuando la fuente permite
 * observar la fecha; en caso contrario declara `unknown` con honestidad.
 *
 * @param {object} input
 * @param {string|null} [input.rotatedAt] Última rotación ISO, o null/ausente
 *                                        si la fuente no lo permite observar.
 * @param {boolean} [input.observable]    Si la fuente permite observarlo.
 * @param {object} [input.thresholds]
 * @param {number} [input.thresholds.warnDays=80]
 * @param {number} [input.thresholds.failDays=90]
 * @param {object} [deps]
 * @param {() => number} [deps.now] Momento actual en ms.
 * @returns {{ status: "ok"|"warn"|"fail"|"unknown", ageDays: number|null, reason: string }}
 */
function assessRotationAge(input, deps = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("assessRotationAge requiere un objeto");
  }
  const now = deps.now ? deps.now() : Date.now();
  const warnDays = input.thresholds && Number.isFinite(input.thresholds.warnDays)
    ? input.thresholds.warnDays
    : 80;
  const failDays = input.thresholds && Number.isFinite(input.thresholds.failDays)
    ? input.thresholds.failDays
    : 90;
  if (!(warnDays > 0) || !(failDays > 0) || warnDays >= failDays) {
    throw new TypeError("thresholds inválidos: 0 < warnDays < failDays");
  }

  const observable = input.observable === false ? false : typeof input.rotatedAt === "string";
  if (!observable || typeof input.rotatedAt !== "string") {
    return {
      status: "unknown",
      ageDays: null,
      reason:
        "La fuente no permite observar la fecha de rotación; no se puede advertir ni fallar por edad (honesto).",
    };
  }

  const rotatedMs = Date.parse(input.rotatedAt);
  if (Number.isNaN(rotatedMs)) {
    return {
      status: "unknown",
      ageDays: null,
      reason: "Fecha de rotación inválida; no se puede evaluar la edad (honesto).",
    };
  }

  const ageDays = Math.floor((now - rotatedMs) / (24 * 3600 * 1000));
  if (ageDays >= failDays) {
    return { status: "fail", ageDays, reason: `Rotación vencida: ${ageDays}d ≥ ${failDays}d (fail).` };
  }
  if (ageDays >= warnDays) {
    return { status: "warn", ageDays, reason: `Rotación próxima a vencer: ${ageDays}d ≥ ${warnDays}d (warn).` };
  }
  return { status: "ok", ageDays, reason: `Rotación dentro de umbral: ${ageDays}d < ${warnDays}d.` };
}

module.exports = {
  STEP_GUIDANCE,
  HISTORY_REWRITE_CHECKLIST,
  buildRunbook,
  historyRewriteChecklist,
  isHistoryRewriteComplete,
  recordRotationEvidence,
  assessRotationAge,
  // Reexport por conveniencia para quien construya runbooks desde cero.
  INCIDENT_CLASS,
  EXPOSURE,
};
