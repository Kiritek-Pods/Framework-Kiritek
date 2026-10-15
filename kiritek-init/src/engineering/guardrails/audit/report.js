"use strict";

/**
 * Salidas de auditoría (T15.5, R19.7): texto humano y reporte multidominio.
 * El reporte multidominio conserva cada dominio por separado y NO expone un
 * booleano global de cumplimiento: un dominio ausente es `absent`, no fallo.
 */

const { STATUSES } = require("./capabilities.js");

function renderText(audit) {
  const lines = [`Kiritek engineering/guardrails — auditoría ${audit.generatedAt}`];
  if (!audit.pack.configured) return [...lines, `  pack: ausente (${audit.pack.reason || "sin configuración"})`].join("\n");
  lines.push(`  catálogo ${audit.catalog.version} · config ${audit.configHash.slice(7, 19)} · pack ${audit.pack.installed ? "instalado" : "no instalado"} · integridad ${audit.pack.integrity}`);
  lines.push("  superficies:");
  for (const [name, s] of Object.entries(audit.surfaces)) lines.push(`    ${name.padEnd(15)} ${s.status}${s.reason ? ` — ${s.reason}` : ""}`);
  lines.push("  capacidades (unidad · control · momento · nivel → estado):");
  for (const r of audit.capabilities) lines.push(`    ${r.unitId} · ${r.controlId} · ${r.moment} · ${r.level} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  lines.push(`  resumen: ${STATUSES.filter((s) => audit.summary.byStatus[s]).map((s) => `${s}=${audit.summary.byStatus[s]}`).join(" ")}`);
  if (audit.notInterceptable && audit.notInterceptable.length) {
    lines.push("  no interceptable (cobertura posterior):");
    for (const n of audit.notInterceptable) lines.push(`    ${n.surface}: ${n.operation} → ${n.coveredBy.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * @param {{engineering?: object|null, security?: object|null}} audits
 *   engineering: salida de runEngineeringAudit; security: capacidades de
 *   `src/audit` (se resume sin reinterpretarlas).
 */
function multiDomainReport(audits) {
  const domains = {};
  const eng = audits.engineering;
  domains.engineering = !eng || !eng.pack.configured
    ? { status: "absent" }
    : { status: "present", catalog: eng.catalog.version, byStatus: eng.summary.byStatus, integrity: eng.pack.integrity };
  const sec = audits.security;
  if (!sec) domains.security = { status: "absent" };
  else {
    const caps = Array.isArray(sec.capabilities) ? sec.capabilities : [];
    const byLastResult = {};
    for (const c of caps) byLastResult[c.lastResult || "unknown"] = (byLastResult[c.lastResult || "unknown"] || 0) + 1;
    domains.security = { status: "present", capabilities: caps.length, byLastResult };
  }
  return { schemaVersion: 1, kind: "multi-domain-audit", domains };
}

module.exports = { renderText, multiDomainReport };
