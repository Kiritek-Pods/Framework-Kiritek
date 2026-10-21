"use strict";

/**
 * Formato humano y JSON de la auditoría por capacidades, con exit code.
 *
 * Exit codes:
 *   0 — todas las capacidades aplicables están OK.
 *   1 — hay fallas (integridad, no ejecutable, drift, etc.).
 *   3 — hay capacidades con estado desconocido/no verificable que importan.
 */

const { validateAgainst } = require("../domain/schema-validator.js");

function statusOf(cap) {
  if (!cap.applicable) return "not_applicable";
  if (cap.integrity === "failed") return "failed";
  // Self-check sintético que no disparó o filtró → falla de control (14.2).
  if (cap.selfCheck && (cap.selfCheck.ran === false || cap.selfCheck.fired === false || cap.selfCheck.leaked === true)) {
    return "failed";
  }
  if (cap.drift) return "drift";

  // Observación remota explícita (14.5, 17.7): `unauthorized` es una falla
  // distinta de `not-configured`, y `unknown` es "no verificable".
  if (cap.observation === "unauthorized") return "failed";
  if (cap.observation === "not-configured") return "missing";
  if (cap.observation === "unknown") return "unknown";
  if (cap.observation === "observed") return "ok";

  // Evidencia presente pero NO fresca (expirada/otro commit): no sostiene
  // `verified` → la capa está degradada aunque esté instalada (11, 14.1).
  if (cap.lastResultFresh === false) return "degraded";

  if (cap.installed && cap.active) return "ok";
  if (cap.installed && !cap.active) return "degraded";
  if (!cap.installed) return "missing";
  return "unknown";
}

function toHuman(audit) {
  const lines = [`Auditoría Kiritek — ${audit.generatedAt}`, ""];
  const summary = { ok: 0, degraded: 0, failed: 0, drift: 0, missing: 0, unknown: 0, not_applicable: 0 };
  for (const cap of audit.capabilities) {
    const st = statusOf(cap);
    summary[st] = (summary[st] || 0) + 1;
    const mark =
      st === "ok" ? "✅" : st === "not_applicable" ? "➖" : st === "unknown" ? "❓" : "❌";
    const obs = cap.observation ? ` [remoto: ${cap.observation}]` : "";
    const sc = cap.selfCheck
      ? ` [self-check: ${cap.selfCheck.fired ? "disparó" : "NO disparó"}${cap.selfCheck.leaked ? ", FILTRÓ" : ""}]`
      : "";
    lines.push(`${mark} ${cap.id}: ${st}${obs}${sc}${cap.reason ? ` — ${cap.reason}` : ""}`);
  }
  lines.push("");
  lines.push(
    `Resumen: ok=${summary.ok} degraded=${summary.degraded} failed=${summary.failed} ` +
      `drift=${summary.drift} missing=${summary.missing} unknown=${summary.unknown} n/a=${summary.not_applicable}`
  );
  return lines.join("\n");
}

function exitCodeFor(audit) {
  let hasFail = false;
  let hasUnknown = false;
  for (const cap of audit.capabilities) {
    if (!cap.applicable) continue;
    const st = statusOf(cap);
    if (st === "failed" || st === "drift" || st === "degraded" || st === "missing") hasFail = true;
    if (st === "unknown") hasUnknown = true;
  }
  if (hasFail) return 1;
  if (hasUnknown) return 3;
  return 0;
}

/**
 * Valida la auditoría contra el schema y devuelve humano/JSON/exit.
 */
function renderAudit(audit) {
  const check = validateAgainst("audit", audit);
  if (!check.valid) {
    const err = new Error(`auditoría no cumple schema: ${check.errors.join("; ")}`);
    err.code = "AUDIT_SCHEMA_INVALID";
    throw err;
  }
  return { human: toHuman(audit), json: JSON.stringify(audit, null, 2), exitCode: exitCodeFor(audit) };
}

module.exports = { statusOf, toHuman, exitCodeFor, renderAudit };
