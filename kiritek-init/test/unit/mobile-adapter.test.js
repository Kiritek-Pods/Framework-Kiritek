"use strict";

/**
 * Tarea 27 — Adaptador de scanners móviles (OWASP Mobile) al contrato común.
 *
 * Cubre:
 *  - 27.3: todo hallazgo móvil pasa por el contrato redactado; `code`/`pattern`
 *    (línea fuente, URL con credenciales, payload) nunca entran en claro.
 *  - 27.5: proyecto Flutter vs no Flutter → `not_applicable` fuera de Flutter.
 *  - 12.6: misma interfaz de resultados/severidad/redacción que el core.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const adapter = require("../../src/scanners/mobile-adapter.js");
const result = require("../../src/domain/result.js");
const { findCanaries } = require("../../src/scanners/redactor.js");

const REPO = "/tmp/demo-flutter";
const SYNTH_AWS = "AKIAIOSFODNN7EXAMPLE";

test("fuera de Flutter: el control móvil es not_applicable, no fallido", () => {
  const { result: res, evidence } = adapter.adaptMobileReport({
    repoRoot: REPO,
    control: "M9",
    isFlutter: false,
  });
  assert.equal(res.decision, result.DECISION.ALLOW);
  assert.equal(res.toolStatus, result.TOOL_STATUS.NOT_APPLICABLE);
  assert.equal(evidence.applicable, false);
  assert.match(res.reason, /no aplicable/i);
});

test("en Flutter sin hallazgos: allow + tool ok", () => {
  const { result: res } = adapter.adaptMobileReport({
    repoRoot: REPO,
    control: "M5",
    isFlutter: true,
    report: { findings: [] },
  });
  assert.equal(res.decision, result.DECISION.ALLOW);
  assert.equal(res.toolStatus, result.TOOL_STATUS.OK);
  assert.equal(res.findings.length, 0);
});

test("hallazgo móvil: el code/pattern con credencial NUNCA entra al Finding", () => {
  const raw = {
    file: "lib/main.dart",
    line: 2,
    issue: "HTTP URL (non-localhost)",
    // Línea fuente con credencial embebida (como la emitiría el scanner Python).
    code: `final url = "http://user:${SYNTH_AWS}@api.example.net?token=${SYNTH_AWS}";`,
    severity: "HIGH",
    recommendation: "Use HTTPS",
  };
  const { result: res } = adapter.adaptMobileReport({
    repoRoot: REPO,
    control: "M5",
    isFlutter: true,
    mode: "enforce",
    report: { findings: [raw] },
  });

  // El contrato prohíbe code/line/match; el Finding sólo lleva metadatos.
  const f = res.findings[0];
  assert.ok(!("code" in f), "el Finding no debe contener 'code'");
  assert.ok(!("match" in f), "el Finding no debe contener 'match'");
  assert.equal(f.path, "lib/main.dart");
  assert.equal(f.lineNumber, 2);
  assert.equal(f.severity, result.SEVERITY.HIGH);

  // El JSON completo del resultado no debe filtrar el canario.
  const serialized = JSON.stringify(res);
  assert.equal(serialized.includes(SYNTH_AWS), false, "el canario no debe aparecer en el resultado");
  assert.deepEqual(findCanaries(serialized), [], "sin canarios tras adaptar");

  // HIGH en enforce → deny.
  assert.equal(res.decision, result.DECISION.DENY);
});

test("severidad MEDIUM en enforce no bloquea (warn)", () => {
  const { result: res } = adapter.adaptMobileReport({
    repoRoot: REPO,
    control: "M2",
    isFlutter: true,
    mode: "enforce",
    report: {
      findings: [{ file: "pubspec.yaml", issue: "Outdated version pin", severity: "MEDIUM", recommendation: "update" }],
    },
  });
  assert.equal(res.decision, result.DECISION.WARN);
});

test("rutas fuera del repo no se propagan crudas", () => {
  const { result: res } = adapter.adaptMobileReport({
    repoRoot: REPO,
    control: "M9",
    isFlutter: true,
    report: { findings: [{ file: "/etc/passwd", issue: "x", severity: "LOW" }] },
  });
  assert.equal(res.findings[0].path, "redacted-path");
});

test("el adaptador no define ningún control de secretos genéricos (G.7)", () => {
  // Sólo capas móviles especializadas; el gate genérico vive en el core.
  const ids = Object.values(adapter.MOBILE_CONTROL_IDS);
  assert.deepEqual(ids.sort(), [
    "mobile.flutter.dependencies",
    "mobile.flutter.network",
    "mobile.flutter.storage",
  ]);
  for (const id of ids) {
    assert.equal(/secret|gitleaks/i.test(id), false, `${id} no debe ser un gate de secretos`);
  }
});
