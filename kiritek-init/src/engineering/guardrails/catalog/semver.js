"use strict";

/**
 * SemVer 2.0.0 mínimo, sin dependencias: parseo estricto, comparación con
 * precedencia de prerelease y `satisfies` para rangos de compatibilidad
 * (`>=`, `>`, `<=`, `<`, `=`, `^`, `~`, AND por espacio, OR con `||`).
 *
 * Los rangos sólo se usan para compatibilidad de motor (Node, kiritek-init).
 * La selección de catálogo exige versión exacta: nunca rangos ni `latest`.
 */

const { SEMVER_RE } = require("../contracts/common.js");

function parse(version) {
  if (typeof version !== "string") return null;
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
    build: m[5] || null,
    raw: version,
  };
}

function isExact(version) {
  return parse(version) !== null;
}

function compareIdentifiers(a, b) {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compara precedencia SemVer (build metadata se ignora). */
function compare(a, b) {
  const pa = typeof a === "string" ? parse(a) : a;
  const pb = typeof b === "string" ? parse(b) : b;
  if (!pa || !pb) throw new TypeError(`semver inválido: ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  for (const k of ["major", "minor", "patch"]) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    if (pa.prerelease[i] === undefined) return -1;
    if (pb.prerelease[i] === undefined) return 1;
    const d = compareIdentifiers(pa.prerelease[i], pb.prerelease[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/** Acepta versiones parciales en rangos: `18`, `18.2` → 18.0.0 / 18.2.0. */
function parseLoose(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) return null;
  return {
    v: parse(`${m[1]}.${m[2] || 0}.${m[3] || 0}${m[4] || ""}`),
    parts: [m[1], m[2], m[3]].filter((x) => x !== undefined).length,
  };
}

function comparatorsFor(token) {
  const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
  const op = m[1] || "=";
  const loose = parseLoose(m[2]);
  if (!loose || !loose.v) throw new TypeError(`rango semver inválido: ${token}`);
  const { v, parts } = loose;
  if (op === "^") {
    const upper =
      v.major > 0 || parts < 2
        ? `${v.major + 1}.0.0-0`
        : v.minor > 0 || parts < 3
          ? `0.${v.minor + 1}.0-0`
          : `0.0.${v.patch + 1}-0`;
    return [[">=", v], ["<", parse(upper)]];
  }
  if (op === "~") {
    const upper = parts < 2 ? `${v.major + 1}.0.0-0` : `${v.major}.${v.minor + 1}.0-0`;
    return [[">=", v], ["<", parse(upper)]];
  }
  if (op === "=" && parts < 3) {
    const upper = parts === 1 ? `${v.major + 1}.0.0-0` : `${v.major}.${v.minor + 1}.0-0`;
    return [[">=", v], ["<", parse(upper)]];
  }
  return [[op, v]];
}

function test(op, version, target) {
  const d = compare(version, target);
  switch (op) {
    case ">=": return d >= 0;
    case ">": return d > 0;
    case "<=": return d <= 0;
    case "<": return d < 0;
    default: return d === 0;
  }
}

/** ¿`version` satisface `range`? Las prerelease sólo se aceptan si se piden. */
function satisfies(version, range) {
  const v = parse(String(version).replace(/^v/, ""));
  if (!v) return false;
  if (typeof range !== "string" || range.trim() === "") throw new TypeError("rango vacío");
  return range.split("||").some((alt) => {
    const tokens = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/).filter(Boolean);
    const comparators = tokens.flatMap(comparatorsFor);
    if (!comparators.every(([op, t]) => test(op, v, t))) return false;
    if (v.prerelease.length === 0) return true;
    return comparators.some(([, t]) => t.prerelease.length > 0 && t.major === v.major && t.minor === v.minor && t.patch === v.patch);
  });
}

module.exports = { parse, isExact, compare, satisfies };
