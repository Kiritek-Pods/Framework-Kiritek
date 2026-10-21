"use strict";

// T16.8: la matriz declarada se ejecuta en CI y los skips sólo existen con
// razón explícita ligada a la matriz de compatibilidad.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { MATRIX, platformCapabilities } = require("../../../src/engineering/guardrails/compatibility.js");

const ROOT = path.join(__dirname, "..", "..", "..");
const WORKFLOW = path.join(ROOT, "..", ".github", "workflows", "kiritek-init-ci.yml");

function engineeringTests() {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".test.js") && out.push(path.join(d, e.name))));
  walk(path.join(ROOT, "test", "engineering"));
  return out;
}

test("T16.8 todo skip de la suite engineering tiene razón explícita; sin .only/.todo/test.skip", () => {
  for (const f of engineeringTests()) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    assert.ok(!/\btest\.(skip|only|todo)\(|\{\s*(only|todo)\s*:/.test(src), `${rel}: skip/only/todo sin razón`);
    for (const m of src.matchAll(/\bskip:\s*([^,}]+)/g)) {
      const expr = m[1].trim();
      assert.ok(/^(POSIX_ONLY|NEEDS_SANDBOX)$/.test(expr) || /&&\s*"[^"]{8,}"$/.test(expr), `${rel}: skip sin razón (${expr})`);
    }
  }
});

test("T16.8 las condiciones de skip son exactamente las que declara la matriz", () => {
  assert.equal(platformCapabilities({ platform: "darwin", nodeVersion: "22.1.0" }).gitHooks, true);
  assert.equal(platformCapabilities({ platform: "win32", nodeVersion: "22.1.0" }).gitHooks, false);
  assert.equal(platformCapabilities({ platform: "linux", nodeVersion: "18.20.0" }).plugins, false);
  const { POSIX_ONLY, NEEDS_SANDBOX } = require("../helpers/platform.js");
  const caps = platformCapabilities();
  assert.equal(POSIX_ONLY === false, caps.gitHooks);
  assert.equal(NEEDS_SANDBOX === false, caps.plugins);
});

test("T16.8 el workflow ejecuta la matriz declarada (SO y Node) con Actions fijadas por SHA", () => {
  const yml = fs.readFileSync(WORKFLOW, "utf8");
  const oses = new Set([...yml.matchAll(/os:\s*([a-z]+)-latest/g)].map((m) => m[1]));
  const map = { ubuntu: "linux", macos: "darwin", windows: "win32" };
  assert.deepEqual([...oses].map((o) => map[o]).sort(), Object.keys(MATRIX.os).sort(), "cada SO declarado tiene job");
  const nodes = new Set([...yml.matchAll(/node:\s*"(\d+)"/g)].map((m) => m[1]));
  assert.deepEqual([...nodes].sort(), [...MATRIX.node.tested].sort(), "cada Node declarado tiene job");
  assert.match(yml, /suite: full/);
  for (const m of yml.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
  assert.ok(!/secrets\./.test(yml));
});
