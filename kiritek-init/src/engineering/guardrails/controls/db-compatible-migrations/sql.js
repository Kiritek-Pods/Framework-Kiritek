"use strict";

/**
 * Clasificación determinista de sentencias SQL de migración (T46.2). No es
 * un parser completo: reconoce las formas de DDL que rompen al código que
 * sigue corriendo durante un deploy (expand/contract).
 */

/** Sentencias sin comentarios ni literales, en mayúsculas y con espacios normalizados. */
function statements(sql) {
  const clean = String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  return clean
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim().toUpperCase())
    .filter(Boolean);
}

const ident = (s) => (s || "").replace(/["`\[\]]/g, "").split(".").pop();
const tableOf = (stmt) => {
  const m = /^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([\w."`\[\]]+)/.exec(stmt) || /^DROP TABLE (?:IF EXISTS )?([\w."`\[\]]+)/.exec(stmt) || /^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?[\w."`]* ?ON (?:ONLY )?([\w."`\[\]]+)/.exec(stmt);
  return m ? ident(m[1]) : null;
};
const createdTable = (stmt) => {
  const m = /^CREATE TABLE (?:IF NOT EXISTS )?([\w."`\[\]]+)/.exec(stmt);
  return m ? ident(m[1]) : null;
};

/** Divide en cláusulas de nivel superior (comas fuera de paréntesis). */
function clauses(stmt) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of stmt) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Clases de cambio incompatible de una sentencia (vacío si es compatible). */
function classify(stmt, dialect) {
  const kinds = [];
  if (/^DROP TABLE\b/.test(stmt)) kinds.push("dropTable");
  if (/^(RENAME TABLE|EXEC SP_RENAME|SP_RENAME)\b/.test(stmt)) kinds.push("rename");
  if (/^ALTER TABLE\b/.test(stmt)) {
    const body = stmt.replace(/^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?[\w."`\[\]]+ ?/, "");
    for (const c of clauses(body)) {
      if (/^DROP (COLUMN\b|(?!CONSTRAINT\b|INDEX\b|KEY\b|PRIMARY\b|FOREIGN\b|DEFAULT\b|NOT\b|CHECK\b)[\w"`]+)/.test(c)) kinds.push("dropColumn");
      if (/^RENAME (COLUMN\b|TO\b|[\w"`]+ TO\b)/.test(c) || /^CHANGE (COLUMN )?[\w"`]+ [\w"`]+/.test(c)) kinds.push("rename");
      if (/^ALTER (COLUMN )?[\w"`]+ (SET DATA )?TYPE\b/.test(c) || /^MODIFY (COLUMN )?[\w"`]+/.test(c)) kinds.push("typeChange");
      if ((/^ADD (COLUMN )?(IF NOT EXISTS )?[\w"`]+\b/.test(c) && !/^ADD (CONSTRAINT|INDEX|KEY|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/.test(c) && /\bNOT NULL\b/.test(c) && !/\bDEFAULT\b/.test(c) && !/\bGENERATED\b/.test(c)) || /^ALTER (COLUMN )?[\w"`]+ SET NOT NULL\b/.test(c)) kinds.push("notNull");
    }
  }
  if (dialect === "postgres" && /^CREATE (UNIQUE )?INDEX\b/.test(stmt) && !/^CREATE (UNIQUE )?INDEX CONCURRENTLY\b/.test(stmt)) kinds.push("blockingIndex");
  return kinds;
}

const KINDS = ["dropColumn", "rename", "dropTable", "typeChange", "notNull", "blockingIndex"];

/**
 * Cuenta cambios incompatibles en las migraciones posteriores a `baseline`.
 * Las tablas creadas después del baseline todavía no están en producción:
 * cambiarlas no rompe a nadie. Una migración de contracción declarada sólo
 * se exime si su expansión ya está desplegada (en o antes del baseline).
 */
function analyze(migrations, { dialect = "generic", baseline = null, exceptions = [] } = {}) {
  const ids = migrations.map((m) => m.id);
  const base = baseline === null ? -1 : ids.indexOf(baseline);
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const pending = base === -1 && baseline !== null ? [] : migrations.slice(base + 1);
  const fresh = new Set();
  let unbacked = 0;
  const exempt = new Set();
  for (const x of exceptions) {
    const at = ids.indexOf(x.expandedBy);
    if (at === -1 || at > base || !ids.includes(x.migration)) unbacked += 1;
    else exempt.add(x.migration);
  }
  for (const m of pending) {
    for (const stmt of statements(m.sql)) {
      const created = createdTable(stmt);
      if (created) {
        fresh.add(created);
        continue;
      }
      const table = tableOf(stmt);
      if (table && fresh.has(table)) continue;
      if (exempt.has(m.id)) continue;
      for (const k of classify(stmt, dialect)) counts[k] += 1;
    }
  }
  return { baselineFound: baseline === null || base !== -1, pending: pending.length, counts, unbacked };
}

module.exports = { statements, classify, analyze, KINDS };
