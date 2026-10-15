"use strict";

/**
 * Carga de waivers y N/A desde los globs configurados (T13). Un archivo por
 * registro (historial auditable por archivo en Git). Devuelve registros
 * normalizados (vigentes y vencidos: el pipeline reactiva los vencidos) y
 * rechazos con códigos, sin copiar razones, owners ni tickets.
 */

const fs = require("node:fs");
const path = require("node:path");
const { containReal } = require("../../../platform/paths.js");
const { compile, hasGlobChars } = require("../workspace/glob.js");
const { validateException } = require("./validate.js");

const MAX_FILES = 1000;
const MAX_BYTES = 64 * 1024;

/** Archivos del repo que casan con el glob (sin seguir symlinks). */
function listGlob(repoRoot, glob) {
  const segments = glob.split("/");
  const literal = [];
  for (const s of segments) {
    if (hasGlobChars(s)) break;
    literal.push(s);
  }
  const re = compile(glob);
  const base = path.join(repoRoot, ...literal);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        if (re.test(rel)) out.push(rel);
      }
    }
  };
  if (literal.length === segments.length) {
    if (fs.existsSync(base) && fs.statSync(base).isFile()) out.push(literal.join("/"));
  } else walk(base);
  return out.sort();
}

/**
 * @param {object} input { repoRoot, resolvedConfig, catalogSnapshot, nowIso }
 * @returns {{records: object[], rejected: object[], diagnostics: object[]}}
 */
function loadExceptions({ repoRoot, resolvedConfig, catalogSnapshot, nowIso }) {
  const policy = resolvedConfig.effective.exceptions;
  const units = new Map(resolvedConfig.effective.units.map((u) => [u.unit.id, { root: u.unit.root }]));
  const controls = new Map(catalogSnapshot.catalog.controls.map((c) => [c.id, { version: c.version }]));
  const fileExists = (rel) => {
    const t = containReal(repoRoot, rel);
    return t.contained && fs.existsSync(t.realPath);
  };
  const records = [];
  const rejected = [];
  const seen = new Set();
  const sources = [
    ...(policy.waiverFiles || []).map((g) => ({ glob: g, kind: "waiver" })),
    ...(policy.notApplicableFiles || []).map((g) => ({ glob: g, kind: "governed-na" })),
  ];
  const visited = new Set();
  for (const { glob, kind } of sources) {
    for (const file of listGlob(repoRoot, glob)) {
      if (visited.has(file)) continue;
      visited.add(file);
      const reject = (errors, doc) =>
        rejected.push({
          file,
          kind,
          ...(doc && typeof doc.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(doc.id) ? { ref: doc.id } : {}),
          ...(doc && typeof doc.unitId === "string" && units.has(doc.unitId) ? { unitId: doc.unitId } : {}),
          ...(doc && typeof doc.controlId === "string" && controls.has(doc.controlId) ? { controlId: doc.controlId } : {}),
          errors,
        });
      const target = containReal(repoRoot, file);
      if (!target.contained || fs.statSync(target.realPath).size > MAX_BYTES) {
        reject(["FILE_UNREADABLE"]);
        continue;
      }
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(target.realPath, "utf8"));
      } catch (_) {
        reject(["PARSE_ERROR"]);
        continue;
      }
      if (!doc || doc.kind !== kind) {
        reject(["KIND_MISMATCH"], doc);
        continue;
      }
      const v = validateException(doc, { nowIso, policy, units, controls, fileExists });
      if (v.status === "invalid") {
        reject(v.errors, doc);
        continue;
      }
      if (seen.has(v.record.id)) {
        reject(["DUPLICATE_ID"], doc);
        continue;
      }
      seen.add(v.record.id);
      records.push(v.record);
    }
  }
  const diagnostics = rejected.length ? [{ code: "EXCEPTIONS_REJECTED", message: `${rejected.length} excepción(es) rechazada(s) por gobierno: no se aplican` }] : [];
  return { records, rejected, diagnostics };
}

module.exports = { loadExceptions, listGlob };
