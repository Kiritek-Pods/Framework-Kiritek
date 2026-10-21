"use strict";

/**
 * Tarea 44 (G.15) — Ausencia de detector de autoría IA como gate.
 *
 * Afirma que en NINGUNA ruta de bloqueo (motor de políticas, guardas Git,
 * adaptadores de asistentes, commits, Jira, auditoría, providers) existe un
 * control que decida allow/warn/deny en función de la "autoría IA" del
 * contenido. Kiritek evalúa hechos verificables (secretos, archivos sensibles,
 * formato de commit, clave Jira, guardas Git), nunca la procedencia humana o
 * automática del texto.
 *
 * Complementa `test/unit/docs-lint.test.js` (que verifica la prohibición en los
 * docs) barriendo el CÓDIGO FUENTE de las rutas de decisión: ningún módulo de
 * `src/` debe implementar un gate basado en autoría/detección de IA.
 *
 * (Requisitos 26.10, G.15.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PKG_ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(PKG_ROOT, "src");

/** Lista recursiva de archivos .js bajo src/. */
function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(abs));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(abs);
  }
  return out;
}

// Identificadores que delatarían un detector de autoría IA USADO COMO GATE.
// Se buscan como tokens de código, no como texto en comentarios de prohibición.
const AUTHORSHIP_GATE_TOKENS = [
  "aiAuthorship",
  "ai_authorship",
  "authorshipScore",
  "aiDetector",
  "detectAiAuthorship",
  "isAiGenerated",
  "aiGeneratedScore",
  "humanAuthored",
];

test("ningún módulo de src/ implementa un gate por autoría IA", () => {
  const files = listJs(SRC);
  assert.ok(files.length > 0, "debe haber módulos en src/");
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const token of AUTHORSHIP_GATE_TOKENS) {
      assert.equal(
        src.includes(token),
        false,
        `${path.relative(PKG_ROOT, file)}: no debe existir un gate por autoría IA (token "${token}")`
      );
    }
  }
});

test("las decisiones de política no exponen un veredicto de autoría IA", () => {
  // El contrato de resultado (allow|warn|deny|error) y sus severidades no deben
  // incluir una dimensión de autoría/procedencia IA.
  const resultSrc = fs.readFileSync(path.join(SRC, "domain", "result.js"), "utf8");
  assert.equal(/autor[ií]a|authorship|ai[-_]?generated/i.test(resultSrc), false,
    "el contrato de resultado no debe modelar autoría IA");
});

test("el detector de canarios/redactor no clasifica por procedencia IA", () => {
  const redactorSrc = fs.readFileSync(path.join(SRC, "scanners", "redactor.js"), "utf8");
  // El redactor opera sobre patrones de secreto, no sobre quién escribió el texto.
  assert.equal(/autor[ií]a|authorship|ai[-_]?author/i.test(redactorSrc), false,
    "el redactor no debe tener lógica de autoría IA");
});
