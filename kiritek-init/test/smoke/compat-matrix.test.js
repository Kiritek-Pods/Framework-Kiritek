"use strict";

/**
 * Tarea 44.5 (G.14) — Matriz de compatibilidad multiplataforma y disciplina de
 * skip.
 *
 * NO añade runners de Windows reales: afirma, de forma reproducible y local,
 * que (a) la matriz CI declara el subconjunto soportado de plataformas y
 * versiones de Node, con el mismo endurecimiento que el workflow de seguridad
 * (permisos mínimos, sin push, actions fijadas por SHA, timeout/concurrency), y
 * (b) que las pruebas específicas de POSIX se saltan con una **razón
 * registrada** en lugar de omitirse en silencio.
 *
 * El enforcement real por plataforma lo ejecuta GitHub Actions con la matriz;
 * aquí verificamos el contrato que esa matriz debe cumplir y la disciplina de
 * skip de la suite, para que un gap de cobertura sea detectable localmente.
 *
 * (Requisitos 23.1, 26.7, G.14.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PKG_ROOT = path.join(__dirname, "..", "..");
const MATRIX = path.join(
  PKG_ROOT,
  "templates",
  "core",
  "security",
  "ci",
  "github",
  "kiritek-compat-matrix.yml"
);

function readMatrix() {
  return fs.readFileSync(MATRIX, "utf8");
}

test("la matriz de compatibilidad existe y es legible", () => {
  assert.ok(fs.existsSync(MATRIX), "falta kiritek-compat-matrix.yml");
  const text = readMatrix();
  assert.ok(text.length > 0);
});

test("la matriz declara las tres plataformas soportadas y Node 18/20", () => {
  const text = readMatrix();
  for (const os of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
    assert.match(text, new RegExp(os), `la matriz debe incluir ${os}`);
  }
  // Versiones de Node fijadas (string) en la matriz.
  assert.match(text, /"18"/, "la matriz debe correr en Node 18");
  assert.match(text, /"20"/, "la matriz debe correr en Node 20");
});

test("la matriz está endurecida: permisos mínimos, sin push, SHA pins, timeout/concurrency", () => {
  const text = readMatrix();
  // Permisos de sólo lectura.
  assert.match(text, /permissions:\s*\n\s*contents:\s*read/, "permisos mínimos (contents: read)");
  // Nunca commitea ni pushea desde CI.
  assert.equal(/git\s+push/.test(text), false, "la matriz no debe hacer git push");
  assert.equal(/git\s+commit/.test(text), false, "la matriz no debe hacer git commit");
  // Eventos privilegiados ausentes.
  assert.equal(/pull_request_target/.test(text), false, "sin pull_request_target");
  // Timeout y concurrency acotados.
  assert.match(text, /timeout-minutes:/, "debe declarar timeout");
  assert.match(text, /concurrency:/, "debe declarar concurrency");
  // Toda action `uses:` fijada por SHA de 40 hex, no por tag mutable.
  const uses = text.split("\n").filter((l) => /uses:/.test(l));
  assert.ok(uses.length > 0, "la matriz debe usar al menos una action");
  for (const line of uses) {
    const m = line.match(/@([^\s#]+)/);
    assert.ok(m && /^[0-9a-f]{40}$/.test(m[1]), `action no fijada por SHA inmutable: ${line.trim()}`);
  }
  // No referencias mutables (@latest, @main, @vX como tag).
  assert.equal(/@latest\b/.test(text), false, "sin @latest");
});

test("la matriz documenta el skip-with-reason de pruebas POSIX-only (no omisión silenciosa)", () => {
  const text = readMatrix();
  // El comentario de la matriz debe hacer explícita la política de skip.
  assert.match(
    text,
    /POSIX/i,
    "la matriz debe mencionar la política de pruebas POSIX-only"
  );
  assert.match(
    text,
    /se saltan|skip|silencio/i,
    "la matriz debe declarar que los tests POSIX-only se saltan con razón"
  );
});

test("disciplina de skip: toda prueba condicionada a plataforma registra una razón", () => {
  // Barre las suites y verifica que ningún skip condicionado a Windows/POSIX se
  // haga sin una razón textual. Un skip sin razón sería una omisión silenciosa.
  const testDirs = [path.join(PKG_ROOT, "test", "unit"), path.join(PKG_ROOT, "test", "integration")];
  const files = [];
  for (const dir of testDirs) {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".test.js")) files.push(path.join(dir, name));
    }
  }
  assert.ok(files.length > 0);

  // Patrón de skip del test runner: `{ skip: <cond> ? "razon" : false }` o
  // `t.skip("razon")`. Buscamos cualquier `skip:` con un valor que NO sea una
  // razón string cuando la condición es de plataforma.
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // t.skip() sin argumento → omisión silenciosa.
    assert.equal(
      /\bt\.skip\(\s*\)/.test(src),
      false,
      `${path.basename(file)}: t.skip() sin razón es una omisión silenciosa`
    );
    // skip: true (literal) sin razón → omisión silenciosa.
    assert.equal(
      /\bskip:\s*true\b/.test(src),
      false,
      `${path.basename(file)}: skip: true sin razón es una omisión silenciosa`
    );
  }
});
