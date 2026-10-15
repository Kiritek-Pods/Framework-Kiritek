"use strict";

/**
 * Waivers y N/A gobernado dentro del pipeline (T06.1, T13). El gobierno
 * (schema, aprobación, expiraciones máximas, alcance no global) se valida al
 * cargar (`exceptions/`); aquí sólo se decide si un registro APLICA.
 *
 * Orden: aplicabilidad técnica → N/A gobernado → evaluación → waiver por
 * finding. Ambos exigen unidad + control exactos y vigencia. Un registro
 * deja de aplicar (reactivación, con diagnóstico y evento) si expiró, si
 * cambió el alcance (scopeHash o paths del cambio fuera de su alcance) o si
 * cambió la versión del control a la que se ató. Nunca convierten un
 * resultado en allow limpio: queda deuda `suppressed`.
 *
 * Registro normalizado: { id, kind, unitId, controlId, expiresAt,
 *   controlVersion?, fingerprint?, ruleId?, paths?, scopeHash? }
 */

const { FINDING_STATUS } = require("../contracts/policy-result.js");
const { firstMatch } = require("../workspace/glob.js");

function matches(record, { unitId, controlId }) {
  return record.unitId === unitId && record.controlId === controlId;
}

/** Motivo por el que un registro ya no aplica (o null si aplica). */
function staleReason(r, ctx, prefix, pathsOk) {
  if (Date.parse(r.expiresAt) <= ctx.nowMs) return { code: `${prefix}_EXPIRED`, message: `${r.id} expirado: el control vuelve a evaluarse` };
  if (r.controlVersion && ctx.controlVersion && r.controlVersion !== ctx.controlVersion) {
    return { code: `${prefix}_CONTROL_CHANGED`, message: `${r.id} se aprobó para ${r.controlId}@${r.controlVersion}; versión actual ${ctx.controlVersion}: no se reutiliza` };
  }
  if ((r.scopeHash && r.scopeHash !== ctx.scopeHash) || !pathsOk) return { code: `${prefix}_SCOPE_CHANGED`, message: `${r.id} corresponde a otro alcance: no se reutiliza` };
  return null;
}

/**
 * N/A gobernado vigente para la unidad/control, o null.
 * ctx: { unitId, controlId, controlVersion?, scopeHash, scopePaths?, unitOwns?, nowMs }
 */
function findGovernedNA(records, ctx) {
  const diagnostics = [];
  const reactivated = [];
  for (const r of (records || []).filter((x) => x.kind === "governed-na" && matches(x, ctx))) {
    let pathsOk = true;
    if (r.paths) {
      const changed = ctx.scopePaths || [];
      // Con cambio: todo path del cambio debe caer en el alcance del N/A.
      // Sin paths (evaluación completa): el N/A debe cubrir toda la unidad.
      pathsOk = changed.length ? changed.every((p) => firstMatch(r.paths, p) !== null) : (ctx.unitOwns || []).every((o) => r.paths.includes(o));
    }
    const stale = staleReason(r, ctx, "GOVERNED_NA", pathsOk);
    if (stale) {
      diagnostics.push({ code: stale.code, message: `N/A ${stale.message}` });
      reactivated.push({ kind: "governed-na", ref: r.id, code: stale.code });
      continue;
    }
    return { record: r, diagnostics, reactivated };
  }
  return { record: null, diagnostics, reactivated };
}

/**
 * Aplica waivers vigentes por fingerprint o ruleId exactos.
 * @returns {{findings, suppressed, diagnostics, reactivated}}
 */
function applyWaivers(findings, records, ctx) {
  const diagnostics = [];
  const suppressed = [];
  const reactivated = new Map();
  const waivers = (records || []).filter((x) => x.kind === "waiver" && matches(x, ctx));
  const out = findings.map((f) => {
    const candidates = waivers.filter((w) => (w.fingerprint !== undefined && w.fingerprint === f.fingerprint) || (w.ruleId !== undefined && w.ruleId === f.ruleId));
    for (const w of candidates) {
      const pathsOk = !w.paths || (typeof f.path === "string" && firstMatch(w.paths, f.path) !== null);
      const stale = staleReason(w, ctx, "WAIVER", pathsOk);
      if (stale) {
        if (!reactivated.has(w.id)) {
          diagnostics.push({ code: stale.code, message: `waiver ${stale.message}; el finding se reactiva` });
          reactivated.set(w.id, { kind: "waiver", ref: w.id, code: stale.code });
        }
        continue;
      }
      suppressed.push({ kind: "waiver", ref: w.id, expiresAt: w.expiresAt, fingerprint: f.fingerprint });
      return { ...f, status: FINDING_STATUS.SUPPRESSED };
    }
    return f;
  });
  return { findings: out, suppressed, diagnostics, reactivated: [...reactivated.values()] };
}

module.exports = { findGovernedNA, applyWaivers };
