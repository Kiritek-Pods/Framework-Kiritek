"use strict";

/**
 * Waivers y N/A gobernado dentro del pipeline (T06.1; gobierno completo y
 * schemas en T13).
 *
 * Orden: aplicabilidad técnica → N/A gobernado → evaluación → waiver por
 * finding. Ambos exigen unidad + control exactos y expiración vigente; un
 * waiver además exige fingerprint y, si declara scopeHash, el mismo alcance.
 * Lo expirado o desajustado no se aplica y se diagnostica (reactivación).
 * Nunca convierten un resultado en allow limpio: queda deuda `suppressed`.
 */

const { FINDING_STATUS } = require("../contracts/policy-result.js");

function matches(record, { unitId, controlId }) {
  return record.unitId === unitId && record.controlId === controlId;
}

/** N/A gobernado vigente para la unidad/control, o null. */
function findGovernedNA(records, ctx) {
  const diagnostics = [];
  for (const r of (records || []).filter((x) => x.kind === "governed-na" && matches(x, ctx))) {
    if (Date.parse(r.expiresAt) <= ctx.nowMs) {
      diagnostics.push({ code: "GOVERNED_NA_EXPIRED", message: `N/A ${r.id} expirado: el control vuelve a evaluarse` });
      continue;
    }
    if (r.scopeHash && r.scopeHash !== ctx.scopeHash) {
      diagnostics.push({ code: "GOVERNED_NA_SCOPE_CHANGED", message: `N/A ${r.id} corresponde a otro alcance: no se aplica` });
      continue;
    }
    return { record: r, diagnostics };
  }
  return { record: null, diagnostics };
}

/**
 * Aplica waivers vigentes por fingerprint.
 * @returns {{findings, suppressed, diagnostics}}
 */
function applyWaivers(findings, records, ctx) {
  const diagnostics = [];
  const suppressed = [];
  const waivers = (records || []).filter((x) => x.kind === "waiver" && matches(x, ctx));
  const out = findings.map((f) => {
    const candidates = waivers.filter((w) => w.fingerprint === f.fingerprint);
    for (const w of candidates) {
      if (Date.parse(w.expiresAt) <= ctx.nowMs) {
        diagnostics.push({ code: "WAIVER_EXPIRED", message: `waiver ${w.id} expirado: el finding se reactiva` });
        continue;
      }
      if (w.scopeHash && w.scopeHash !== ctx.scopeHash) {
        diagnostics.push({ code: "WAIVER_SCOPE_CHANGED", message: `waiver ${w.id} corresponde a otro alcance: no se reutiliza` });
        continue;
      }
      suppressed.push({ kind: "waiver", ref: w.id, expiresAt: w.expiresAt, fingerprint: f.fingerprint });
      return { ...f, status: FINDING_STATUS.SUPPRESSED };
    }
    return f;
  });
  return { findings: out, suppressed, diagnostics };
}

module.exports = { findGovernedNA, applyWaivers };
