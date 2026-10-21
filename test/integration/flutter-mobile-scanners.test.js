"use strict";

/**
 * Tarea 27 (validación 27.5) — Scanners móviles OWASP del pack Flutter.
 *
 * Ejercita los scanners Python REALES contra un proyecto Flutter sintético con
 * un canario embebido y comprueba, en conjunto:
 *
 *  - 27.1 / G.7: el gate genérico de secretos NO vive en Flutter. M1 es una
 *    delegación al core: no reimplementa detección ni produce un reporte propio
 *    de secretos (owasp_m1_secrets_scan.json).
 *  - 27.3 / G.12: los scanners móviles (M2/M5/M9) redactan `code`/`pattern`;
 *    ningún canario sintético aparece en stdout, stderr ni en el JSON persistido.
 *  - 27.4: la nomenclatura de M2 es honesta — "outdated/heuristic", nunca una
 *    afirmación de CVE verificado sin fuente de advisories.
 *  - 27.5: proyecto no Flutter → los scanners no inventan hallazgos móviles.
 *
 * No hay secretos reales: sólo el canario sintético AKIAIOSFODNN7EXAMPLE.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SKILL_DIR = path.resolve(
  __dirname,
  "../../templates/stacks/flutter/.claude/skills/owasp-mobile-security-checker/scripts"
);
const SYNTH_AWS = "AKIAIOSFODNN7EXAMPLE";

function hasPython() {
  const r = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

function hasYaml() {
  const r = spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" });
  return r.status === 0;
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kiritek-m27-${prefix}-`));
}

function makeFlutterProject() {
  const root = tmpDir("flutter");
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "pubspec.yaml"),
    "name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^0.11.0\n"
  );
  // Línea fuente con canario embebido en una URL HTTP con credenciales.
  fs.writeFileSync(
    path.join(root, "lib", "main.dart"),
    [
      "import 'package:http/http.dart' as http;",
      `final url = "http://user:${SYNTH_AWS}@api.example.net/v1?token=${SYNTH_AWS}";`,
      "void main() { http.get(Uri.parse(url)); }",
    ].join("\n")
  );
  return root;
}

function runScanner(script, projectRoot) {
  const r = spawnSync("python3", [path.join(SKILL_DIR, script), projectRoot], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readJsonIfExists(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

const python = hasPython();

test("M5/M9 redactan: ningún canario en stdout/stderr ni en el JSON persistido", { skip: !python ? "python3 no disponible" : false }, () => {
  const root = makeFlutterProject();
  try {
    const m5 = runScanner("check_network_security.py", root);
    const m9 = runScanner("analyze_storage_security.py", root);

    const m5json = readJsonIfExists(path.join(root, "owasp_m5_network_scan.json")) || "";
    const m9json = readJsonIfExists(path.join(root, "owasp_m9_storage_scan.json")) || "";

    const all = [m5.stdout, m5.stderr, m9.stdout, m9.stderr, m5json, m9json].join("\n");
    assert.equal(all.includes(SYNTH_AWS), false, "el canario sintético no debe aparecer en ninguna salida móvil");
    // El `code` que contenía la URL con credenciales debe haber sido redactado.
    assert.ok(m5json.includes("[REDACTED]"), "M5 debe redactar el campo code");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("M1 es delegación: no reimplementa detección ni produce owasp_m1_secrets_scan.json", { skip: !python ? "python3 no disponible" : false }, () => {
  const root = makeFlutterProject();
  try {
    const r = runScanner("scan_hardcoded_secrets.py", root);
    const out = r.stdout + r.stderr;
    // Delegación explícita al core; sin gate propio.
    assert.match(out, /delegated to the Kiritek core/i);
    // No debe emitir un reporte de secretos divergente.
    assert.equal(
      fs.existsSync(path.join(root, "owasp_m1_secrets_scan.json")),
      false,
      "M1 no debe generar su propio reporte de secretos (sin gate divergente)"
    );
    // Y jamás debe imprimir el canario (no escanea, no filtra).
    assert.equal(out.includes(SYNTH_AWS), false, "M1 no debe imprimir el canario");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("M2 usa nomenclatura honesta: heurística/outdated, nunca CVE verificado sin fuente", { skip: !python || !hasYaml() ? "python3/yaml no disponible" : false }, () => {
  const root = makeFlutterProject();
  try {
    const r = runScanner("check_dependencies.py", root);
    const json = readJsonIfExists(path.join(root, "owasp_m2_dependencies_scan.json")) || "";
    const parsed = JSON.parse(json);
    const finding = parsed.findings.find((f) => f.package === "http");
    assert.ok(finding, "debe detectar el pin viejo de http");
    assert.match(finding.issue, /outdated|heuristic/i, "el issue debe describirse como heurística/outdated");
    assert.match(finding.issue, /not a verified CVE/i, "debe aclarar que no es un CVE verificado");
    assert.ok("advisory_source" in finding, "debe declarar la ausencia de fuente de advisories");
    assert.match(finding.advisory_source, /none|heuristic/i);
    // No debe afirmar un CVE concreto (CVE-XXXX-YYYY) sin fuente.
    assert.equal(/CVE-\d{4}-\d{3,}/.test(json), false, "no debe afirmar un identificador CVE sin advisory");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("proyecto no Flutter: M5/M9 no inventan hallazgos móviles (sin lib/*.dart)", { skip: !python ? "python3 no disponible" : false }, () => {
  const root = tmpDir("nonflutter");
  try {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "web" }));
    const m5 = runScanner("check_network_security.py", root);
    const m9 = runScanner("analyze_storage_security.py", root);
    const m5json = JSON.parse(readJsonIfExists(path.join(root, "owasp_m5_network_scan.json")) || "{}");
    const m9json = JSON.parse(readJsonIfExists(path.join(root, "owasp_m9_storage_scan.json")) || "{}");
    // Sin Dart ni manifiestos móviles no debe haber hallazgos basados en código.
    assert.equal(m5json.total_files_scanned, 0);
    assert.equal(m9json.total_files_scanned, 0);
    assert.equal(m9json.total_findings, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
