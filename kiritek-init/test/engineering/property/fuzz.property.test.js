"use strict";

// T16.2: property/fuzz de schemas, paths, precedencia de config, alcance de
// monorepo, identidad de cache y waivers, contra predicados de referencia
// escritos aparte. Semillas fijas: los fallos son reproducibles.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { validateAgainst } = require("../../../src/domain/schema-validator.js");
const c = require("../../../src/engineering/guardrails/contracts/common.js");
const { ownersOf, PATH_STATUS } = require("../../../src/engineering/guardrails/workspace/ownership.js");
const { matches } = require("../../../src/engineering/guardrails/workspace/glob.js");
const { keyFor, KEY_PARTS } = require("../../../src/engineering/guardrails/runtime/cache.js");
const { resolveEngineeringConfig, levelFor } = require("../../../src/engineering/guardrails/config/index.js");
const { applyWaivers } = require("../../../src/engineering/guardrails/pipeline/exceptions.js");

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

// --- schemas ------------------------------------------------------------------------------

function randomValue(r, depth = 0) {
  const k = pick(r, depth > 3 ? ["str", "num", "bool", "null"] : ["str", "num", "bool", "null", "arr", "obj", "obj"]);
  if (k === "str") return pick(r, ["", "x", "../etc", "sha256:abc", "apps/web/**", "\u0000", "é😀", "a".repeat(300), "warn", "enforce"]);
  if (k === "num") return pick(r, [0, -1, 1.5, 1e9, NaN, Infinity]);
  if (k === "bool") return r() < 0.5;
  if (k === "null") return null;
  if (k === "arr") return Array.from({ length: Math.floor(r() * 4) }, () => randomValue(r, depth + 1));
  const o = {};
  for (let i = 0; i < Math.floor(r() * 5); i += 1) o[pick(r, ["schemaVersion", "id", "kind", "level", "pack", "units", "controls", "__proto__x", "extra"])] = randomValue(r, depth + 1);
  return o;
}

test("T16.2 schemas: el validador nunca lanza y rechaza basura aleatoria en todos los schemas engineering", () => {
  const dir = path.join(__dirname, "..", "..", "..", "schemas", "engineering");
  const schemas = [
    ...fs.readdirSync(dir).filter((f) => f.endsWith(".schema.json")).map((f) => `engineering/${f.replace(".schema.json", "")}`),
    ...fs.readdirSync(path.join(dir, "controls")).map((f) => `engineering/controls/${f.replace(".schema.json", "")}`),
  ];
  assert.ok(schemas.length >= 20);
  const r = prng(16021);
  let rejected = 0;
  for (const schema of schemas) {
    for (let i = 0; i < 60; i += 1) {
      const v = randomValue(r);
      let res;
      assert.doesNotThrow(() => (res = validateAgainst(schema, v, { extended: true })), schema);
      if (!res.valid) rejected += 1;
    }
  }
  assert.ok(rejected / (schemas.length * 60) > 0.95, "la basura aleatoria casi nunca es válida");
});

// --- paths -------------------------------------------------------------------------------

// Propiedades de seguridad: sin traversal, no absoluta (POSIX/Windows), sin
// backslash, NUL ni `~` (segmentos vacíos o barra final no escapan del repo).
const referenceSafe = (p) =>
  typeof p === "string" && p.length > 0 && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.includes("\\") && !p.includes("\0") && !p.split("/").some((s) => s === "..") && !p.startsWith("~");

test("T16.2 paths: toda ruta aceptada es relativa, sin traversal, absolutas, backslash ni NUL (3000 casos)", () => {
  const r = prng(7);
  const parts = ["apps", "web", "..", ".", "", "~", "C:", "a b", "ñ", "x\\y", "\u0000", "src", "/", "file.ts"];
  for (let i = 0; i < 3000; i += 1) {
    const p = Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, parts)).join(pick(r, ["/", "/", "\\"]));
    let accepted = true;
    try {
      c.assertRepoRelativePath(p, "p");
    } catch (_) {
      accepted = false;
    }
    if (accepted) assert.ok(referenceSafe(p), `aceptada una ruta insegura: ${JSON.stringify(p)}`);
  }
});

// --- monorepo scope ---------------------------------------------------------------------------

test("T16.2 monorepo: cada path se asigna exactamente a las unidades cuyo owns casa y ningún exclude (2000 casos)", () => {
  const r = prng(99);
  const units = [
    { id: "acme/web", owns: ["apps/web/**"], excludes: ["apps/web/legacy/**"] },
    { id: "acme/shared-ui", owns: ["packages/ui/**", "apps/web/components/**"], excludes: [] },
    { id: "acme/api", owns: ["services/api/**"], excludes: ["services/api/**/*.md"] },
  ];
  const segs = ["apps", "web", "legacy", "components", "packages", "ui", "services", "api", "docs", "README.md", "index.ts", "x.md"];
  for (let i = 0; i < 2000; i += 1) {
    const p = Array.from({ length: 1 + Math.floor(r() * 5) }, () => pick(r, segs)).join("/");
    const res = ownersOf(p, units, ["tools/**"]);
    const want = units.filter((u) => u.owns.some((g) => matches(g, p)) && !u.excludes.some((g) => matches(g, p))).map((u) => u.id).sort();
    assert.deepEqual(res.owners.map((o) => o.unitId).sort(), want, p);
    if (!want.length) assert.notEqual(res.status, PATH_STATUS.OWNED, `${p} sin dueño no puede quedar owned`);
    else assert.equal(res.status, PATH_STATUS.OWNED);
  }
});

// --- cache identity ------------------------------------------------------------------------------

test("T16.2 identidad de cache: cambiar cualquier parte cambia la clave; misma identidad, misma clave", () => {
  const r = prng(4242);
  const base = () => Object.fromEntries(KEY_PARTS.map((k) => [k, k === "collectorVersions" ? { "a/collector": "1.0.0" } : k === "profileVersions" ? ["search@1.0.0"] : `${k}-v`]));
  const k0 = keyFor(base());
  for (let i = 0; i < 400; i += 1) {
    const parts = base();
    const field = pick(r, KEY_PARTS);
    parts[field] = field === "collectorVersions" ? { "a/collector": `1.0.${1 + Math.floor(r() * 9)}` } : field === "profileVersions" ? [`search@1.${1 + Math.floor(r() * 9)}.0`] : `${field}-${Math.floor(r() * 1e6)}`;
    assert.notEqual(keyFor(parts), k0, `cambiar ${field} debe cambiar la clave`);
    assert.equal(keyFor(base()), k0);
  }
  const incomplete = base();
  delete incomplete.revision;
  assert.throws(() => keyFor(incomplete), /incompleta/);
});

// --- config precedence ----------------------------------------------------------------------------

test("T16.2 precedencia: flag > env > unidad > defaults del repo > catálogo, por par unidad/control (300 casos)", () => {
  const r = prng(2718);
  const CONTROL = "web.module-announcement";
  const levels = [undefined, "off", "warn"];
  for (let i = 0; i < 300; i += 1) {
    const layer = { repo: pick(r, levels), unit: pick(r, levels), env: pick(r, levels), flag: pick(r, levels) };
    const doc = {
      schemaVersion: 1,
      pack: { id: "engineering/guardrails", catalog: "1.0.0" },
      workspace: { units: [{ id: "acme/web", root: "apps/web", kind: "application", profiles: [{ id: "web", version: "1.0.0" }], owns: ["apps/web/**"], ...(layer.unit ? { controls: { [CONTROL]: { level: layer.unit } } } : {}) }] },
      ...(layer.repo ? { defaults: { controls: { [CONTROL]: { level: layer.repo } } } } : {}),
    };
    const resolved = resolveEngineeringConfig({ document: doc, env: layer.env ? { KIRITEK_ENGINEERING_LEVELS: `${CONTROL}=${layer.env}` } : {}, flags: layer.flag ? { levels: [`${CONTROL}=${layer.flag}`] } : {} });
    const want = layer.flag || layer.env || layer.unit || layer.repo || "warn";
    assert.equal(levelFor(resolved, "acme/web", CONTROL), want, JSON.stringify(layer));
  }
});

// --- waivers --------------------------------------------------------------------------------------

test("T16.2 waivers: suprimen exactamente cuando unidad, control, objetivo, alcance, versión y vigencia coinciden (3000 casos)", () => {
  const r = prng(1234);
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const ctx = { unitId: "acme/web", controlId: "search.input-rate", controlVersion: "1.0.0", scopeHash: `sha256:${"1".repeat(64)}`, scopePaths: [], unitOwns: ["apps/web/**"], nowMs: NOW };
  for (let i = 0; i < 3000; i += 1) {
    const finding = { ruleId: pick(r, ["search.input-rate/cadence", "search.input-rate/dedupe"]), path: pick(r, ["apps/web/a.ts", "apps/web/sub/b.ts", "apps/docs/c.ts"]), fingerprint: pick(r, ["fp-1", "fp-2"]), severity: "high", evidenceClass: "deterministic" };
    const w = {
      id: "W-x",
      kind: "waiver",
      unitId: pick(r, ["acme/web", "acme/web", "acme/docs"]),
      controlId: pick(r, ["search.input-rate", "search.input-rate", "app.minimum-supported-version"]),
      expiresAt: pick(r, ["2026-12-01T00:00:00Z", "2026-12-01T00:00:00Z", "2026-10-01T00:00:00Z"]),
      ...(r() < 0.5 ? { fingerprint: pick(r, ["fp-1", "fp-2", "fp-3"]) } : { ruleId: pick(r, ["search.input-rate/cadence", "search.input-rate/minimum"]) }),
      ...(r() < 0.5 ? { paths: [pick(r, ["apps/web/**", "apps/web/sub/**"])] } : {}),
      ...(r() < 0.3 ? { controlVersion: pick(r, ["1.0.0", "0.9.0"]) } : {}),
      ...(r() < 0.2 ? { scopeHash: pick(r, [ctx.scopeHash, `sha256:${"2".repeat(64)}`]) } : {}),
    };
    const reference =
      w.unitId === ctx.unitId &&
      w.controlId === ctx.controlId &&
      Date.parse(w.expiresAt) > NOW &&
      (w.fingerprint !== undefined ? w.fingerprint === finding.fingerprint : w.ruleId === finding.ruleId) &&
      (!w.paths || w.paths.some((g) => matches(g, finding.path))) &&
      (!w.controlVersion || w.controlVersion === ctx.controlVersion) &&
      (!w.scopeHash || w.scopeHash === ctx.scopeHash);
    const out = applyWaivers([finding], [w], ctx);
    assert.equal(out.findings[0].status === "suppressed", reference, JSON.stringify({ w, finding }));
  }
});
