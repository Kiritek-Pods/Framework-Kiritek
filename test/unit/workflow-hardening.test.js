"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const WORKFLOWS = [
  path.join(ROOT, "metrics", "kiritek-audit.yml"),
  path.join(ROOT, "templates", "core", "security", "ci", "github", "kiritek-security.yml"),
];

function read(p) {
  return fs.readFileSync(p, "utf8");
}

test("workflows: no hacen git push ni git commit", () => {
  for (const wf of WORKFLOWS) {
    const content = read(wf);
    assert.equal(/git\s+push/.test(content), false, `${path.basename(wf)} no debe hacer git push`);
    assert.equal(/git\s+commit/.test(content), false, `${path.basename(wf)} no debe hacer git commit`);
  }
});

test("workflows: declaran permisos (contents: read)", () => {
  for (const wf of WORKFLOWS) {
    const content = read(wf);
    assert.ok(/permissions:/.test(content), `${path.basename(wf)} debe declarar permissions`);
    assert.ok(/contents:\s*read/.test(content), `${path.basename(wf)} debe usar contents: read`);
  }
});

test("workflows: fijan actions por SHA de 40 chars, no por tag mutable", () => {
  // Un pin válido es exactamente @<40-hex>. Un tag mutable es cualquier
  // referencia @... que NO sea un hash hex de 40 caracteres.
  const refUse = /uses:\s+[\w.-]+\/[\w.-]+@(\S+)/;
  for (const wf of WORKFLOWS) {
    const content = read(wf);
    const lines = content.split("\n").filter((l) => /uses:/.test(l));
    assert.ok(lines.length > 0, `${path.basename(wf)} debe usar al menos una action`);
    for (const line of lines) {
      const m = line.match(refUse);
      assert.ok(m, `línea uses sin referencia: ${line.trim()}`);
      const ref = m[1];
      assert.ok(/^[0-9a-f]{40}$/.test(ref), `action no fijada por SHA de 40 chars: ${line.trim()}`);
    }
  }
});

test("workflows: declaran timeout y concurrency", () => {
  for (const wf of WORKFLOWS) {
    const content = read(wf);
    assert.ok(/timeout-minutes:/.test(content), `${path.basename(wf)} debe declarar timeout`);
    assert.ok(/concurrency:/.test(content), `${path.basename(wf)} debe declarar concurrency`);
  }
});

test("auditoría: sube artefacto en vez de commitear el reporte", () => {
  const content = read(WORKFLOWS[0]);
  assert.ok(/upload-artifact/.test(content), "la auditoría debe subir artefacto");
});
