"use strict";

/**
 * Corre tests archivo por archivo (TAP) y produce un resultado de job
 * (`kiritek-init/test-job`): plataforma, Node, revisión y conteos por
 * archivo. Cada job de la matriz CI sube el suyo; el gate los junta.
 * Sólo rutas relativas y nombres de tests: nada de salida cruda.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const SUITES = Object.freeze({ engineering: "test/engineering", full: "test" });

function listTestFiles(suite, root = ROOT) {
  const base = SUITES[suite];
  if (!base) throw new Error(`suite desconocida: ${suite}`);
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".test.js")) out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(path.join(root, base));
  return out;
}

/** Conteos del trailer TAP y nombres de los tests de primer nivel que fallan. */
function parseTap(text) {
  const num = (k) => {
    const m = new RegExp(`^# ${k} (\\d+)$`, "m").exec(text);
    return m ? Number(m[1]) : 0;
  };
  const failures = [];
  for (const m of text.matchAll(/^not ok \d+ - (.+)$/gm)) failures.push(m[1].replace(/\s+#\s*(SKIP|TODO).*$/i, "").trim());
  return { tests: num("tests"), pass: num("pass"), fail: num("fail"), skipped: num("skipped"), todo: num("todo"), cancelled: num("cancelled"), failures };
}

// Los tests que lanzan `node` por nombre (harness trace-command) deben usar el
// mismo Node del job, no el primero del PATH.
function jobEnv() {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  return { ...process.env, [key]: [path.dirname(process.execPath), process.env[key] || ""].join(path.delimiter) };
}

/**
 * Diagnóstico de los tests que fallan (bloques YAML de TAP tras cada
 * `not ok`). Sólo para el log del job: nunca se persiste en el resultado.
 */
function failureDiagnostics(text, maxLines = 60) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length && out.length < maxLines; i += 1) {
    if (!/^\s*not ok \d+ - /.test(lines[i])) continue;
    out.push(lines[i].trim());
    for (let j = i + 1; j < lines.length && out.length < maxLines && !/^\s*(not )?ok \d+ - /.test(lines[j]); j += 1) {
      if (/^\s*(---|\.\.\.|duration_ms:|type:)/.test(lines[j]) || /^\s*#/.test(lines[j])) continue;
      out.push(lines[j].replace(/\s+$/, ""));
    }
  }
  return out;
}

function runFile(file, root) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--require", "./test/setup.js", "--test", "--test-reporter=tap", file], { cwd: root, env: jobEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", () => {});
    child.on("close", (code) => {
      const r = parseTap(out);
      // Un archivo que sale ≠ 0 sin ningún fallo contado (crash al cargar) cuenta como fallo.
      if (code !== 0 && r.fail === 0 && r.cancelled === 0) {
        r.fail = 1;
        r.failures.push("(el archivo terminó con error sin reportar tests)");
      }
      const result = { file, exit: code === null ? 1 : code, ...r };
      // No enumerable: el log del job lo muestra, el JSON del resultado no lo guarda.
      if (r.fail) Object.defineProperty(result, "diagnostics", { value: failureDiagnostics(out), enumerable: false });
      resolve(result);
    });
  });
}

async function runFiles(files, { root = ROOT, concurrency = 4, onFile } = {}) {
  const results = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      results[i] = await runFile(files[i], root);
      if (onFile) onFile(results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}

function gitRevision(root = ROOT) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Estado del árbol limitado a kiritek-init (lo que el pack publica y prueba). */
function gitDirty(root = ROOT) {
  const r = spawnSync("git", ["status", "--porcelain", "--", "."], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().length > 0 : null;
}

function totals(files) {
  const t = { files: files.length, tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  for (const f of files) for (const k of ["tests", "pass", "fail", "skipped", "todo", "cancelled"]) t[k] += f[k];
  return t;
}

async function runJob({ suite, root = ROOT, now = () => new Date().toISOString(), concurrency, onFile } = {}) {
  const startedAt = now();
  const files = await runFiles(listTestFiles(suite, root), { root, concurrency, onFile });
  const t = totals(files);
  return {
    schemaVersion: 1,
    kind: "kiritek-init/test-job",
    os: process.platform,
    node: process.versions.node,
    suite,
    revision: gitRevision(root),
    startedAt,
    finishedAt: now(),
    totals: t,
    files,
    status: t.fail === 0 && t.cancelled === 0 && files.every((f) => f.exit === 0) ? "pass" : "fail",
  };
}

module.exports = { ROOT, SUITES, listTestFiles, parseTap, failureDiagnostics, runFiles, runJob, gitRevision, gitDirty, totals };
