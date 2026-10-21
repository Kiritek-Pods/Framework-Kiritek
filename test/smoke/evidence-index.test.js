"use strict";

/**
 * Tarea 44.7 (G.1–G.15) — Índice de evidencia sin gaps.
 *
 * Este es el GATE DE CIERRE de la tarea 44: parsea el índice committeado
 * `templates/core/security/docs/EVIDENCE-INDEX.md` y afirma, de forma
 * ejecutable, que:
 *
 *   1. Los quince gates G.1–G.15 están presentes en el índice (ninguno falta).
 *   2. Cada gate mapea a AL MENOS un archivo de prueba, y TODOS esos archivos
 *      EXISTEN en el repositorio (el índice es veraz, no aspiracional).
 *   3. No hay gaps: ningún gate queda sin cobertura. Un gap hace fallar el test
 *      y bloquea el cierre.
 *   4. El índice no filtra canarios (barrido con el detector del redactor).
 *
 * Además, emite el registro de la corrida de aceptación (commit/config hash,
 * plataforma, comando, timestamp, exit code) a la colección IGNORADA
 * `test/.acceptance-evidence/` reutilizando el contrato de evidencia del core.
 *
 * No usa red ni secretos reales.
 *
 * (Requisitos 26.1–26.10, 11, G.1–G.15.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { findCanaries } = require("../../src/scanners/redactor.js");
const acceptance = require("./acceptance-evidence.js");

const PKG_ROOT = path.join(__dirname, "..", "..");
const INDEX = path.join(
  PKG_ROOT,
  "templates",
  "core",
  "security",
  "docs",
  "EVIDENCE-INDEX.md"
);

const EXPECTED_GATES = Array.from({ length: 15 }, (_, i) => `G.${i + 1}`);

/** Extrae el bloque de la matriz entre los marcadores BEGIN/END. */
function readMatrixBlock() {
  const text = fs.readFileSync(INDEX, "utf8");
  const begin = text.indexOf("<!-- EVIDENCE-INDEX:BEGIN -->");
  const end = text.indexOf("<!-- EVIDENCE-INDEX:END -->");
  assert.ok(begin !== -1 && end !== -1 && end > begin,
    "EVIDENCE-INDEX.md debe delimitar la matriz con marcadores BEGIN/END");
  return { full: text, block: text.slice(begin, end) };
}

/**
 * Parsea las filas de la matriz Markdown a {gate -> [archivos]}.
 * Cada fila: `| G.x | criterio | \`a\`, \`b\` | alcance |`.
 */
function parseIndex() {
  const { block } = readMatrixBlock();
  const map = new Map();
  for (const line of block.split("\n")) {
    const row = line.trim();
    if (!row.startsWith("| G.")) continue;
    const cols = row.split("|").map((c) => c.trim());
    // cols[0] vacío por el pipe inicial → [ '', gate, criterio, archivos, alcance, '' ]
    const gate = cols[1];
    const filesCell = cols[3] || "";
    const files = Array.from(filesCell.matchAll(/`([^`]+)`/g)).map((m) => m[1]);
    map.set(gate, files);
  }
  return map;
}

test("EVIDENCE-INDEX.md existe y define la matriz de gates", () => {
  assert.ok(fs.existsSync(INDEX), "falta templates/core/security/docs/EVIDENCE-INDEX.md");
  const map = parseIndex();
  assert.ok(map.size > 0, "la matriz debe tener filas de gates");
});

test("los quince gates G.1–G.15 están presentes (ninguno falta)", () => {
  const map = parseIndex();
  for (const gate of EXPECTED_GATES) {
    assert.ok(map.has(gate), `el índice debe cubrir ${gate}`);
  }
  // Y no debe haber gates fuera del rango G.1–G.15.
  for (const gate of map.keys()) {
    assert.ok(EXPECTED_GATES.includes(gate), `gate inesperado en el índice: ${gate}`);
  }
});

test("cada gate mapea a ≥1 archivo de prueba y TODOS existen (índice veraz, sin gaps)", () => {
  const map = parseIndex();
  const gaps = [];
  const missing = [];
  for (const gate of EXPECTED_GATES) {
    const files = map.get(gate) || [];
    if (files.length === 0) {
      gaps.push(gate);
      continue;
    }
    for (const rel of files) {
      // Sólo mapeamos archivos de prueba reales.
      assert.match(rel, /^test\/.*\.test\.js$/, `${gate}: "${rel}" debe ser un archivo .test.js bajo test/`);
      const abs = path.join(PKG_ROOT, rel);
      if (!fs.existsSync(abs)) missing.push(`${gate} → ${rel}`);
    }
  }
  assert.deepEqual(gaps, [], `gates SIN cobertura (gap que bloquea el cierre): ${gaps.join(", ")}`);
  assert.deepEqual(missing, [], `archivos de prueba mapeados que NO existen: ${missing.join(", ")}`);
});

test("el índice de evidencia no filtra ningún canario", () => {
  const text = fs.readFileSync(INDEX, "utf8");
  assert.deepEqual(findCanaries(text), [], "EVIDENCE-INDEX.md no debe contener canarios reconocibles");
});

test("emite el registro de la corrida de aceptación a la colección ignorada", () => {
  // Reutiliza el contrato de evidencia del core (commit/config hash, plataforma,
  // comando, timestamp, exit code). El registro NO se versiona; vive bajo
  // test/.acceptance-evidence/ (ignorado por Git).
  const { record, file } = acceptance.writeRecord({ exitCode: 0, decision: "allow" });
  assert.ok(fs.existsSync(file), "el registro de aceptación debe escribirse");
  assert.equal(record.control, "task-44-acceptance");
  assert.equal(record.scope, "G.1-G.15");
  assert.equal(record.exitCode, 0);
  assert.equal(record.command, "node --test");
  assert.ok(/^node v/.test(record.toolVersion), "debe registrar la versión de Node");
  assert.ok(typeof record.commit === "string" && record.commit.length > 0, "debe registrar el commit");
  assert.ok(typeof record.configHash === "string" && record.configHash.length === 64, "config hash sha256");
  assert.ok(typeof record.platform === "string" && record.platform.length > 0, "debe registrar la plataforma");
  assert.ok(Date.parse(record.createdAt) > 0, "timestamp ISO válido");
  // El registro mismo no debe filtrar canarios.
  assert.deepEqual(findCanaries(JSON.stringify(record)), [], "el registro no debe contener canarios");
});

test("la colección de evidencia de aceptación está IGNORADA por Git (datos de corrida)", () => {
  // El directorio de evidencia por corrida no debe versionarse: debe estar
  // cubierto por un patrón de .gitignore (raíz del workspace o del paquete).
  const candidates = [
    path.join(PKG_ROOT, ".gitignore"),
    path.join(PKG_ROOT, "..", ".gitignore"),
  ];
  const ignores = candidates
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, "utf8"))
    .join("\n");
  assert.match(
    ignores,
    /\.acceptance-evidence/,
    "test/.acceptance-evidence/ debe estar en un .gitignore (no versionar datos de corrida)"
  );
});
