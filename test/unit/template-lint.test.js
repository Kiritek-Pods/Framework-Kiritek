"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  lintTemplate,
  ALLOWED_SECTIONS,
  topLevelSections,
} = require("../../src/policy/template-lint.js");

const TPL_DIR = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "core",
  "security",
  "templates"
);

const PR = fs.readFileSync(path.join(TPL_DIR, "PULL_REQUEST_TEMPLATE.md"), "utf8");
const TICKET = fs.readFileSync(path.join(TPL_DIR, "TICKET_TEMPLATE.md"), "utf8");

// --- 29.1: PR limitado a los campos permitidos ---

test("PR: secciones exactamente las permitidas (18.1)", () => {
  const sections = topLevelSections(PR);
  assert.deepEqual(sections, [...ALLOWED_SECTIONS.pr]);
});

test("PR: lint sin violaciones de sección ni datos sensibles", () => {
  const res = lintTemplate(PR, { kind: "pr" });
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

// --- 29.2: Ticket limitado a los campos permitidos ---

test("ticket: secciones exactamente las permitidas (18.2)", () => {
  const sections = topLevelSections(TICKET);
  assert.deepEqual(sections, [...ALLOWED_SECTIONS.ticket]);
});

test("ticket: lint sin violaciones", () => {
  const res = lintTemplate(TICKET, { kind: "ticket" });
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

// --- 29.4: N/A permitido con razón breve (18.4) ---

test("plantillas permiten N/A (campos no obligan relleno)", () => {
  for (const tpl of [PR, TICKET]) {
    assert.match(tpl, /N\/A/, "la plantilla debe documentar que se puede marcar N/A");
  }
});

test("fixtures N/A pasan el lint de solicitud de datos sensibles", () => {
  // Un valor rellenado como N/A no debe disparar violaciones.
  const naBody = [
    "## Impacto en secretos y datos",
    "N/A — no toca secretos ni PII",
    "## Dependencias",
    "N/A — sin dependencias",
  ].join("\n");
  const res = lintTemplate(naBody);
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

// --- 29.3: prohibir solicitudes de secretos/dumps/tokens/prompts/logs crudos ---

test("rechaza una plantilla que PIDE secretos/tokens", () => {
  const bad = "## Secretos\nPega aquí el token de producción y las credenciales.";
  const res = lintTemplate(bad);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === "request-sensitive"));
});

test("rechaza una plantilla que pide logs sin redactar", () => {
  const bad = "## Logs\nAdjunta los logs sin redactar de la ejecución.";
  const res = lintTemplate(bad);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === "unredacted-log" || v.code === "request-sensitive"));
});

test("rechaza una plantilla que pide un dump de base de datos", () => {
  const bad = "## Datos\nIncluye un dump de base de datos del entorno.";
  const res = lintTemplate(bad);
  assert.equal(res.ok, false);
});

test("rechaza una plantilla que pide el prompt completo", () => {
  const bad = "## IA\nPega el prompt completo usado con el asistente.";
  const res = lintTemplate(bad);
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === "request-sensitive"));
});

test("NO cuenta como violación una PROHIBICIÓN de pegar secretos", () => {
  const good = "## Evidencia\nNO pegues secretos ni tokens; enlaza el reporte redactado.";
  const res = lintTemplate(good);
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

// --- Secciones inesperadas ---

test("detecta una sección fuera del conjunto permitido", () => {
  const extra = PR + "\n## Campo extra no permitido\n";
  const res = lintTemplate(extra, { kind: "pr" });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === "unexpected-section"));
});
