"use strict";

/**
 * Auditoría engineering por capacidades reales (T15.1, T15.2, T15.6).
 *
 * Una fila por unidad × control × momento del catálogo. Cada capa se
 * verifica por separado (instalación, integridad, configuración, linkage,
 * superficie, última ejecución, frescura, drift) y el estado resume sin
 * inferir cumplimiento por existencia:
 *
 *   absent · off · suggested · not_applicable · unavailable · unknown ·
 *   stale · conflict · drift · verified
 *
 * `verified` exige una ejecución registrada para la revisión actual con la
 * misma config, catálogo y versión de control, evidencia presente y la
 * superficie del momento intacta. Independiente de core/security.
 */

const fs = require("node:fs");
const path = require("node:path");
const { PACK_ID, DOMAIN } = require("../contracts/common.js");
const { CONFIG_FILE } = require("../config/defaults.js");
const { profileRequirement } = require("../workspace/units.js");
const { coverageMatrix } = require("../adapters/coverage.js");
const { readEvidence } = require("../privacy/evidence-store.js");
const { readRunLedgers, controlConfigHash } = require("./ledger.js");
const { observeSurfaces, momentSurfaceStatus } = require("./surfaces.js");
const inventory = require("../../../install/inventory.js");

const STATUS = Object.freeze({
  ABSENT: "absent",
  OFF: "off",
  SUGGESTED: "suggested",
  NOT_APPLICABLE: "not_applicable",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
  STALE: "stale",
  CONFLICT: "conflict",
  DRIFT: "drift",
  VERIFIED: "verified",
});
const STATUSES = Object.freeze(Object.values(STATUS));

function checkLinkage(control, impl) {
  if (!impl) return "missing";
  const ids = (impl.collectors || []).map((x) => x.id).sort();
  if (JSON.stringify(ids) !== JSON.stringify([...control.collectors].sort())) return "unsupported";
  if (!impl.evaluator || typeof impl.evaluator.evaluate !== "function") return "unsupported";
  return "verified";
}

/** Integridad de los artefactos del pack (excepto la config, que el usuario edita). */
function packState(repoRoot) {
  const inv = inventory.readInventory(repoRoot);
  const entries = Object.entries(inv.entries).filter(([, e]) => e.owner === PACK_ID);
  if (!entries.length) return { installed: false, integrity: "unknown", altered: [] };
  const altered = [];
  for (const [rel, e] of entries) {
    if (rel === CONFIG_FILE) continue;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) altered.push({ path: rel, reason: "missing" });
    else if (e.installedHash && inventory.hashFile(abs) !== e.installedHash) altered.push({ path: rel, reason: "modified" });
  }
  return { installed: true, integrity: altered.length ? "failed" : "ok", altered };
}

function count(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    out[k] = out[k] || Object.fromEntries(STATUSES.map((s) => [s, 0]));
    out[k][r.status] += 1;
  }
  return out;
}

/**
 * @param {object} input
 * @param {string} input.repoRoot
 * @param {object} input.resolvedConfig
 * @param {object} input.catalogSnapshot
 * @param {object} input.resolvedUnits
 * @param {Record<string, object>} input.controls     Implementaciones (builtinControls()).
 * @param {string} input.nowIso
 * @param {string|null} [input.revision]              HEAD actual.
 * @param {object[]} [input.suggestions]              Discovery (no autoritativo).
 * @param {{rejected: object[]}} [input.exceptions]   Salida de loadExceptions.
 * @param {string} [input.version]                    Versión instalada del pack.
 */
function runEngineeringAudit(input) {
  const { repoRoot, resolvedConfig, catalogSnapshot: snap, resolvedUnits, controls, nowIso } = input;
  const nowMs = Date.parse(nowIso);
  const evidenceDir = resolvedConfig.effective.evidence.directory;
  const pack = { ...packState(repoRoot), configured: true, version: input.version || null };
  const surfaces = observeSurfaces(repoRoot, { platform: input.platform });
  const { ledgers, diagnostics } = readRunLedgers({ repoRoot, directory: evidenceDir });
  const suggestions = input.suggestions || [];
  const rows = [];

  for (const unit of resolvedUnits.units) {
    for (const control of snap.catalog.controls) {
      const cfg = unit.controls[control.id];
      const req = profileRequirement(unit, control, suggestions);
      const linkage = checkLinkage(control, controls[control.id]);
      for (const { moment } of control.moments) {
        const surf = momentSurfaceStatus(moment, surfaces);
        const ledger = ledgers[moment];
        const last = ledger ? ledger.results.find((r) => r.unitId === unit.id && r.controlId === control.id) : null;
        const row = {
          id: `${PACK_ID}:${unit.id}:${control.id}:${moment}`,
          unitId: unit.id,
          controlId: control.id,
          controlVersion: control.version,
          moment,
          packId: PACK_ID,
          catalogVersion: snap.ref.version,
          catalogDigest: snap.ref.digest,
          profiles: [...req.matched.map((p) => ({ id: p.id, status: p.status })), ...req.missing.map((p) => ({ id: p.id, status: p.status }))],
          applicable: req.satisfied,
          applicabilityStatus: req.satisfied ? "applicable" : req.missing.some((p) => p.status === "suggested") ? "suggested" : "not_applicable",
          installed: pack.installed,
          version: pack.version,
          integrity: pack.integrity,
          configured: !!cfg,
          active: !!cfg && cfg.level !== "off",
          executable: linkage === "verified",
          linkage,
          momentCovered: surf.status,
          level: cfg ? cfg.level : "off",
          enforcementEligible: (control.supportedLevels || []).includes("enforce") && !!control.enforcementContract && control.enforcementContract.moments.includes(moment),
          lastRun: last ? ledger.at : null,
          lastResult: last ? last.decision : "unknown",
          lastResultFresh: false,
          drift: pack.integrity === "failed" || surf.status === "drift",
          evidenceRef: null,
          observation: last ? "observed" : surf.status === "unavailable" ? "not-configured" : "unknown",
        };
        let status;
        let reason = null;
        if (row.level === "off") [status, reason] = [STATUS.OFF, "nivel off (no equivale a conforme)"];
        else if (!req.satisfied) {
          status = row.applicabilityStatus === "suggested" ? STATUS.SUGGESTED : STATUS.NOT_APPLICABLE;
          reason = `perfiles requeridos ${status === STATUS.SUGGESTED ? "sólo sugeridos" : "ausentes"}: ${req.missing.map((p) => p.id).join(", ")}`;
          row.observation = "not-applicable";
        } else if (linkage !== "verified") [status, reason] = [STATUS.UNAVAILABLE, `implementación ${linkage}: collectors/evaluator no enlazados con el catálogo`];
        else if (!last) {
          status = surf.status === "drift" ? STATUS.DRIFT : STATUS.UNKNOWN;
          reason = surf.reason ? `sin ejecución registrada; ${surf.reason}` : "sin ejecución registrada en este momento";
        } else if (
          (last.controlConfigHash ? last.controlConfigHash !== controlConfigHash(resolvedConfig, unit.id, control.id) : ledger.configHash !== resolvedConfig.configHash) ||
          ledger.catalog.digest !== snap.ref.digest ||
          last.controlVersion !== control.version
        ) {
          [status, reason] = [STATUS.DRIFT, "la última ejecución usó otra config, catálogo o versión de control"];
        } else if (input.revision && ledger.revision !== input.revision) {
          [status, reason] = [STATUS.STALE, `evidencia de otra revisión (${ledger.revision.slice(0, 12)})`];
        } else if (nowMs - Date.parse(ledger.at) > control.freshness.maxAgeSeconds * 1000) {
          [status, reason] = [STATUS.STALE, "última ejecución más antigua que la frescura del control"];
        } else if (last.state === "conflict" || last.evidenceFreshness === "conflict") [status, reason] = [STATUS.CONFLICT, "evidencia en conflicto (no reproducible)"];
        else if (["unavailable", "timeout", "unknown", "not_evaluated"].includes(last.state)) [status, reason] = [STATUS.UNAVAILABLE, `última ejecución ${last.state}`];
        else if (last.state === "stale" || last.evidenceFreshness === "stale") [status, reason] = [STATUS.STALE, "evidencia vencida en la última ejecución"];
        else if (last.state === "not_applicable") [status, reason] = [STATUS.NOT_APPLICABLE, "no aplicable en la última ejecución (p. ej. N/A gobernado)"];
        else if (last.state === "off") [status, reason] = [STATUS.OFF, "off en la última ejecución"];
        else {
          const ev = last.evidenceRef ? readEvidence({ repoRoot, directory: evidenceDir, unitId: unit.id, controlId: control.id, expected: { revision: ledger.revision, configHash: ledger.configHash, catalogDigest: ledger.catalog.digest, unitId: unit.id, controlId: control.id, controlVersion: control.version, scopeHash: "" }, nowMs: () => nowMs }).entries.find((e) => e.evidence.id === last.evidenceRef) : null;
          if (!ev) [status, reason] = [STATUS.UNKNOWN, "la evidencia referida por la última ejecución no está disponible"];
          else {
            row.evidenceRef = ev.path;
            row.lastResultFresh = true;
            if (surf.status === "drift") [status, reason] = [STATUS.DRIFT, surf.reason];
            else status = STATUS.VERIFIED;
          }
        }
        if (pack.integrity === "failed" && status === STATUS.VERIFIED) [status, reason] = [STATUS.DRIFT, "artefactos del pack alterados"];
        rows.push({ ...row, status, ...(reason ? { reason } : {}) });
      }
    }
  }

  const profiles = resolvedUnits.units.map((u) => ({
    unitId: u.id,
    declared: u.profiles.map((p) => ({ id: p.id, version: p.version, source: p.source })),
    suggested: suggestions.filter((s) => s.unitId === u.id && s.requiresAcceptance).map((s) => ({ id: s.profile.id, confidence: s.confidence })),
    controls: Object.fromEntries(Object.entries(u.controls).map(([id, c]) => [id, { level: c.level }])),
  }));
  const rejected = (input.exceptions && input.exceptions.rejected) || [];
  return {
    schemaVersion: 1,
    domain: DOMAIN.ENGINEERING,
    packId: PACK_ID,
    generatedAt: nowIso,
    catalog: { ...snap.ref },
    configHash: resolvedConfig.configHash,
    ...(input.revision ? { revision: input.revision } : {}),
    pack: { installed: pack.installed, version: pack.version, integrity: pack.integrity, configured: true, altered: pack.altered },
    surfaces,
    profiles,
    capabilities: rows,
    notInterceptable: coverageMatrix(snap.catalog).notInterceptable,
    exceptions: { rejected: rejected.length },
    summary: {
      total: rows.length,
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])),
      byUnit: count(rows, "unitId"),
      byControl: count(rows, "controlId"),
      byMoment: count(rows, "moment"),
      byLevel: count(rows, "level"),
    },
    diagnostics,
  };
}

/** Auditoría cuando el pack no está configurado: `absent`, no fallo. */
function absentAudit({ nowIso, version, reason }) {
  return {
    schemaVersion: 1,
    domain: DOMAIN.ENGINEERING,
    packId: PACK_ID,
    generatedAt: nowIso,
    pack: { installed: false, version: version || null, integrity: "unknown", configured: false, status: STATUS.ABSENT, reason },
    capabilities: [],
    summary: { total: 0, byStatus: Object.fromEntries(STATUSES.map((s) => [s, 0])) },
    diagnostics: [],
  };
}

module.exports = { STATUS, STATUSES, runEngineeringAudit, absentAudit, checkLinkage };
