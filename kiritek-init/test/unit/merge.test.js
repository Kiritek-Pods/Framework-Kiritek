"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const merge = require("../../src/install/merge.js");

test("mergeManagedBlock: añade bloque a archivo existente preservando contenido", () => {
  const original = "node_modules\ndist\n";
  const { content, changed } = merge.mergeManagedBlock(original, [".kiritek/security/"]);
  assert.equal(changed, true);
  assert.ok(content.startsWith("node_modules\ndist\n"));
  assert.ok(content.includes(merge.BEGIN));
  assert.ok(content.includes(".kiritek/security/"));
  assert.ok(content.includes(merge.END));
});

test("mergeManagedBlock: idempotente (segunda corrida no cambia bytes)", () => {
  const original = "node_modules\n";
  const once = merge.mergeManagedBlock(original, [".kiritek/security/"]).content;
  const twice = merge.mergeManagedBlock(once, [".kiritek/security/"]);
  assert.equal(twice.changed, false);
  assert.equal(twice.content, once);
});

test("mergeManagedBlock: no duplica entrada que el usuario ya tenía fuera del bloque", () => {
  const original = ".kiritek/security/\nnode_modules\n";
  const { content } = merge.mergeManagedBlock(original, [".kiritek/security/"]);
  // La entrada del usuario sigue; el bloque no la repite.
  const occurrences = content.split(".kiritek/security/").length - 1;
  assert.equal(occurrences, 1);
});

test("mergeManagedBlock: reemplaza interior de un bloque existente al cambiar entradas", () => {
  const first = merge.mergeManagedBlock("x\n", ["a/"]).content;
  const second = merge.mergeManagedBlock(first, ["a/", "b/"]);
  assert.ok(second.content.includes("a/"));
  assert.ok(second.content.includes("b/"));
  // No debe duplicar el marcador de inicio.
  assert.equal(second.content.split(merge.BEGIN).length - 1, 1);
});

test("mergeManagedBlock: preserva CRLF cuando el archivo lo usa", () => {
  const original = "node_modules\r\ndist\r\n";
  const { content } = merge.mergeManagedBlock(original, ["a/"]);
  assert.ok(content.includes("\r\n"));
  assert.ok(!/(?<!\r)\n/.test(content.replace(/\r\n/g, "")));
});

test("mergeJson: agrega sólo claves faltantes y no sobrescribe", () => {
  const original = { a: 1, nested: { x: 1 } };
  const additions = { b: 2, nested: { y: 2 } };
  const { merged, conflicts, changed } = merge.mergeJson(original, additions);
  assert.deepEqual(merged, { a: 1, b: 2, nested: { x: 1, y: 2 } });
  assert.deepEqual(conflicts, []);
  assert.equal(changed, true);
});

test("mergeJson: reporta conflicto cuando una clave existe con otro valor", () => {
  const original = { a: 1 };
  const additions = { a: 2 };
  const { merged, conflicts } = merge.mergeJson(original, additions);
  assert.equal(merged.a, 1); // no sobrescribe
  assert.deepEqual(conflicts, ["a"]);
});

test("mergeJson: idempotente", () => {
  const original = { a: 1 };
  const r1 = merge.mergeJson(original, { b: 2 });
  const r2 = merge.mergeJson(r1.merged, { b: 2 });
  assert.equal(r2.changed, false);
  assert.deepEqual(r2.merged, r1.merged);
});

test("proposalPath: genera .kiritek-new junto al original", () => {
  assert.equal(merge.proposalPath("CLAUDE.md"), "CLAUDE.md.kiritek-new");
});
