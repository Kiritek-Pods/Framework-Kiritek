"use strict";

/**
 * Tarea 45 [CP] — Definition of Done y aceptación de la iniciativa.
 *
 * Este es el GATE TERMINAL de la iniciativa. Parsea el acta committeada
 * `templates/core/security/docs/DEFINITION-OF-DONE.md` y afirma, de forma
 * ejecutable, que:
 *
 *   1. Los nueve criterios 45.1–45.9 están presentes en la matriz (ninguno
 *      falta y no hay criterios fuera del rango).
 *   2. Cada criterio mapea a ≥1 artefacto real; TODOS existen en el repo
 *      (el acta es veraz, no aspiracional). Un mapeo faltante es un GAP que
 *      bloquea el release candidate.
 *   3. Todo artefacto `.test.js` mapeado es un archivo de prueba real bajo
 *      `test/`; el resto son documentos/artefactos existentes.
 *   4. La suite completa queda VERDE y SIN SKIPS en el momento de la
 *      aceptación (se corre `node --test` en un subproceso aislado).
 *   5. El acta no filtra ningún canario (barrido con el detector del redactor).
 *
 * No usa red ni secretos reales.
 *
 * Nota anti-recursión: la aserción de "suite verde" relanza `node --test` en un
 * subproceso con `KIRITEK_DOD_SUBPROCESS=1`. Dentro de ese subproceso, este
 * mismo test detecta la variable y OMITE relanzar la suite (sólo corre sus
 * aserciones estáticas), evitando recursión infinita.
 *
 * (Requisitos 26.1–26.10, 11; cierra 1–28 y G.1–G.15.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { findCanaries } = require("../../src/scanners/redactor.js");

const PKG_ROOT = path.join(__dirname, "..", "..");
const DOC = path.join(
  PKG_ROOT,
  "templates",
  "core",
  "security",
  "docs",
  "DEFINITION-OF-DONE.md"
);

const EXPECTED_CRITERIA = Array.from({ length: 9 }, (_, i) => `45.${i + 1}`);
const IN_SUBPROCESS = process.env.KIRITEK_DOD_SUBPROCESS === "1";

/** Extrae el bloque de la matriz entre los marcadores BEGIN/END. */
function readMatrixBlock() {
  const text = fs.readFileSync(DOC, "utf8");
  const begin = text.indexOf("<!-- DEFINITION-OF-DONE:BEGIN -->");
  const end = text.indexOf("<!-- DEFINITION-OF-DONE:END -->");
  assert.ok(
    begin !== -1 && end !== -1 && end > begin,
    "DEFINITION-OF-DONE.md debe delimitar la matriz con marcadores BEGIN/END"
  );
  return { full: text, block: text.slice(begin, end) };
}

/**
 * Parsea las filas de la matriz Markdown a {criterio -> [artefactos]}.
 * Cada fila: `| 45.x | enunciado | tareas | \`a\`, \`b\` |`.
 */
function parseMatrix() {
  const { block } = readMatrixBlock();
  const map = new Map();
  for (const line of block.split("\n")) {
    const row = line.trim();
    if (!row.startsWith("| 45.")) continue;
    const cols = row.split("|").map((c) => c.trim());
    // [ '', criterio, enunciado, tareas, artefactos, '' ]
    const criterion = cols[1];
    const artifactsCell = cols[4] || "";
    const artifacts = Array.from(artifactsCell.matchAll(/`([^`]+)`/g)).map(
      (m) => m[1]
    );
    map.set(criterion, artifacts);
  }
  return map;
}

test("DEFINITION-OF-DONE.md existe y define la matriz de aceptación", () => {
  assert.ok(
    fs.existsSync(DOC),
    "falta templates/core/security/docs/DEFINITION-OF-DONE.md"
  );
  const map = parseMatrix();
  assert.ok(map.size > 0, "la matriz debe tener filas de criterios");
});

test("los nueve criterios 45.1–45.9 están presentes (ninguno falta)", () => {
  const map = parseMatrix();
  for (const criterion of EXPECTED_CRITERIA) {
    assert.ok(map.has(criterion), `el acta debe cubrir ${criterion}`);
  }
  for (const criterion of map.keys()) {
    assert.ok(
      EXPECTED_CRITERIA.includes(criterion),
      `criterio inesperado en el acta: ${criterion}`
    );
  }
});

test("cada criterio mapea a ≥1 artefacto REAL y todos existen (acta veraz, sin gaps)", () => {
  const map = parseMatrix();
  const gaps = [];
  const missing = [];
  for (const criterion of EXPECTED_CRITERIA) {
    const artifacts = map.get(criterion) || [];
    if (artifacts.length === 0) {
      gaps.push(criterion);
      continue;
    }
    for (const rel of artifacts) {
      const abs = path.join(PKG_ROOT, rel);
      if (!fs.existsSync(abs)) missing.push(`${criterion} → ${rel}`);
    }
  }
  assert.deepEqual(
    gaps,
    [],
    `criterios SIN artefacto (gap que bloquea el release candidate): ${gaps.join(", ")}`
  );
  assert.deepEqual(
    missing,
    [],
    `artefactos mapeados que NO existen (mapeo aspiracional = gap): ${missing.join(", ")}`
  );
});

test("todo artefacto .test.js mapeado es un archivo de prueba real bajo test/", () => {
  const map = parseMatrix();
  let testFileCount = 0;
  for (const criterion of EXPECTED_CRITERIA) {
    for (const rel of map.get(criterion) || []) {
      if (!rel.endsWith(".test.js")) continue;
      testFileCount += 1;
      assert.match(
        rel,
        /^test\/.*\.test\.js$/,
        `${criterion}: "${rel}" debe ser un .test.js bajo test/`
      );
      assert.ok(
        fs.existsSync(path.join(PKG_ROOT, rel)),
        `${criterion}: falta el archivo de prueba ${rel}`
      );
    }
  }
  assert.ok(
    testFileCount >= EXPECTED_CRITERIA.length,
    "cada criterio debe estar sostenido por al menos un archivo de prueba"
  );
});

test("el acta de Definition of Done no filtra ningún canario", () => {
  const text = fs.readFileSync(DOC, "utf8");
  assert.deepEqual(
    findCanaries(text),
    [],
    "DEFINITION-OF-DONE.md no debe contener canarios reconocibles"
  );
});

// La aserción de "suite verde" sólo se registra en la corrida PRINCIPAL. Dentro
// del subproceso de verificación (KIRITEK_DOD_SUBPROCESS=1) este test NO se
// registra en absoluto: así el subproceso no suma ningún skip y su conteo
// `# skipped 0` es una señal honesta de que la suite no omite nada. Esto evita
// a la vez la recursión infinita y un falso "skipped" en el reporte aceptado.
if (!IN_SUBPROCESS) {
  test("la suite completa está VERDE y SIN SKIPS en el momento de la aceptación", () => {
    // Relanza la suite en un subproceso aislado con el flag anti-recursión.
    // Se eliminan las variables internas del test runner (NODE_TEST_CONTEXT y
    // afines) para que el subproceso no se interprete como una invocación
    // recursiva de `node --test` (que, de lo contrario, omite correr archivos).
    const childEnv = { ...process.env, KIRITEK_DOD_SUBPROCESS: "1" };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith("NODE_TEST_")) delete childEnv[key];
    }
    const res = spawnSync(process.execPath, ["--test", "--test-reporter=tap"], {
      cwd: PKG_ROOT,
      encoding: "utf8",
      env: childEnv,
      maxBuffer: 64 * 1024 * 1024,
    });

    const out = `${res.stdout || ""}\n${res.stderr || ""}`;

    assert.equal(
      res.status,
      0,
      `la suite debe terminar con exit 0 en la aceptación (status=${res.status})\n${out}`
    );

    const pass = out.match(/^# pass (\d+)$/m);
    const fail = out.match(/^# fail (\d+)$/m);
    const skipped = out.match(/^# skipped (\d+)$/m);
    const todo = out.match(/^# todo (\d+)$/m);

    assert.ok(pass, `el reporte TAP debe incluir el conteo de pass\n${out}`);
    assert.ok(Number(pass[1]) > 0, "debe reportar un conteo de pass > 0");
    assert.equal(fail && Number(fail[1]), 0, "no debe haber pruebas fallidas");
    assert.equal(
      skipped && Number(skipped[1]),
      0,
      "no debe haber pruebas saltadas en la aceptación"
    );
    assert.equal(todo && Number(todo[1]), 0, "no debe haber pruebas pendientes (todo)");
  });
}
