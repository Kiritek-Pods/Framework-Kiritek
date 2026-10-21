"use strict";

/**
 * Adaptador CI/PR provider-neutral (T14.5, T14.8).
 *
 * El YAML del proveedor sólo calcula contexto e invoca el CLI core
 * (`guardrails scan`); aquí no hay reglas. Este módulo:
 *  - planifica la invocación (momento, rango, flags) a partir del evento;
 *  - nunca requiere secretos (forks sin secretos funcionan igual);
 *  - convierte el reporte en anotaciones neutrales (archivo, nivel, regla).
 */

const EVENTS = Object.freeze(["pull_request", "push", "release", "manual"]);
const SHA_RE = /^[0-9a-f]{7,64}$/;

/**
 * @param {object} ctx { event, base?, head, artifactRef?, units?: string[], shallow? }
 * @returns {{ok:true, moment, args:string[], notes:string[]} | {ok:false, code, remediation}}
 */
function planCiInvocation(ctx) {
  if (!EVENTS.includes(ctx.event)) return { ok: false, code: "CI_EVENT_UNKNOWN", remediation: `Use uno de: ${EVENTS.join(", ")}.` };
  if (!SHA_RE.test(String(ctx.head || ""))) return { ok: false, code: "CI_HEAD_REQUIRED", remediation: "Pase el SHA de la revisión evaluada." };
  const notes = [];
  if (ctx.event === "release") {
    if (!ctx.artifactRef) return { ok: false, code: "CI_ARTIFACT_REQUIRED", remediation: "Release evalúa un artefacto/config candidata: pase --artifact." };
    if (!ctx.units || !ctx.units.length) return { ok: false, code: "CI_UNIT_REQUIRED", remediation: "Release requiere --unit explícita." };
    return { ok: true, moment: "release", args: ["guardrails", "scan", "--moment=release", `--revision=${ctx.head}`, `--artifact=${ctx.artifactRef}`, ...ctx.units.map((u) => `--unit=${u}`), "--offline", "--format=json"], notes };
  }
  if (!SHA_RE.test(String(ctx.base || ""))) return { ok: false, code: "CI_BASE_REQUIRED", remediation: "PR evalúa el rango completo: pase el SHA base." };
  if (ctx.shallow) notes.push("checkout shallow: si falta la base, el scan falla como SCOPE_RANGE_INCOMPLETE (operativo, nunca deny); use fetch-depth: 0");
  return { ok: true, moment: "pr", args: ["guardrails", "scan", "--moment=pr", `--base=${ctx.base}`, `--revision=${ctx.head}`, "--offline", "--format=json"], notes };
}

const LEVEL = { deny: "failure", warn: "warning", error: "notice", allow: null };

/**
 * Anotaciones provider-neutral. Una por finding activo (o por resultado si
 * no hay findings). Un error operativo es `notice`, nunca `failure`.
 */
function toAnnotations(report) {
  const out = [];
  for (const e of report.results) {
    if (!e.result) continue;
    const base = LEVEL[e.result.decision];
    if (!base) continue;
    const level = e.result.decision === "deny" && !e.blockingEligible ? "warning" : base;
    const active = (e.result.findings || []).filter((f) => f.status !== "suppressed");
    if (!active.length) {
      out.push({ level, unitId: e.unit.id, controlId: e.control.id, title: `${e.control.id} (${e.result.decision})`, message: e.result.reason || e.result.decision });
      continue;
    }
    for (const f of active) {
      const heuristic = (e.findingEvidence.find((x) => x.fingerprint === f.fingerprint) || {}).evidenceClass !== "deterministic";
      out.push({
        level: heuristic && level === "failure" ? "warning" : level,
        unitId: e.unit.id,
        controlId: e.control.id,
        ruleId: f.ruleId,
        ...(f.path ? { path: f.path } : {}),
        title: f.ruleId,
        message: f.remediation || e.result.reason || f.ruleId,
      });
    }
  }
  return out;
}

/** Resumen Markdown neutral (comentario de PR / job summary). */
function toSummary(report) {
  const lines = [`### Kiritek engineering — ${report.moment}: ${report.outcome.decision}`, "", "| Unidad | Control | Estado | Decisión |", "|---|---|---|---|"];
  for (const e of report.results) lines.push(`| ${e.unit.id} | ${e.control.id} | ${e.state} | ${e.result ? e.result.decision : "—"} |`);
  if (report.exceptions && report.exceptions.applied.length) {
    lines.push("", `Deuda: ${report.exceptions.debt.waivers} waiver(s), ${report.exceptions.debt.notApplicable} N/A; próximo vencimiento ${report.exceptions.nextExpiry}.`);
  }
  return lines.join("\n");
}

module.exports = { EVENTS, planCiInvocation, toAnnotations, toSummary };
