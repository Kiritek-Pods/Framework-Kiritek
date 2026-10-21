#!/usr/bin/env node
"use strict";

/**
 * Gate de release del pack engineering (T17).
 *
 *   node scripts/release-gate.js --job <full|engineering> --out <file>
 *       Corre la suite archivo por archivo y escribe el resultado del job
 *       (lo usa cada job de la matriz CI).
 *
 *   node scripts/release-gate.js [--jobs <dir>] [--no-local] [--out <file>]
 *       Evalúa el gate: corre la suite completa local (salvo --no-local), suma
 *       los resultados de jobs en <dir> y escribe la evidencia. Exit 0 si el
 *       gate está ready, 3 si está bloqueado.
 *
 *   node scripts/release-gate.js --approve --evidence <file>
 *       Publica con evidencia ready de la revisión actual (approved.json,
 *       catálogo 2.0.0, pin de plantilla, procedencia).
 */

const fs = require("node:fs");
const path = require("node:path");
const { runJob, ROOT } = require("../release/gate/jobs.js");
const { evaluateGate, applyApproval } = require("../release/gate/gate.js");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name) => process.argv.includes(name);
const log = (s) => process.stderr.write(`${s}\n`);

function readJobs(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".json")) {
        try {
          const j = JSON.parse(fs.readFileSync(abs, "utf8"));
          if (j && j.kind === "kiritek-init/test-job") out.push(j);
        } catch (_) {
          log(`ignorado (no es JSON): ${path.relative(process.cwd(), abs)}`);
        }
      }
    }
  };
  walk(dir);
  return out;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const progress = (f) => {
  log(`${f.fail || f.exit ? "✗" : "✓"} ${f.file} (${f.pass}/${f.tests}${f.skipped ? `, ${f.skipped} skip` : ""})`);
  if (process.env.CI && f.diagnostics) for (const line of f.diagnostics) log(`    ${line}`);
};

async function main() {
  if (has("--approve")) {
    const file = arg("--evidence");
    if (!file) throw new Error("--approve requiere --evidence <file>");
    const res = applyApproval({ evidence: JSON.parse(fs.readFileSync(file, "utf8")) });
    process.stdout.write(`${JSON.stringify({ ok: true, ...res }, null, 2)}\n`);
    return 0;
  }

  const suite = arg("--job");
  if (suite) {
    const job = await runJob({ suite, onFile: progress });
    const out = arg("--out") || `kiritek-test-job-${process.platform}-node${process.versions.node.split(".")[0]}-${suite}.json`;
    writeJson(path.resolve(out), job);
    log(`job ${job.status}: ${job.totals.pass}/${job.totals.tests} pass, ${job.totals.fail} fail, ${job.totals.skipped} skip → ${out}`);
    return job.status === "pass" ? 0 : 1;
  }

  const jobs = arg("--jobs") ? readJobs(path.resolve(arg("--jobs"))) : [];
  if (!has("--no-local")) {
    log("corriendo suite completa local…");
    jobs.push(await runJob({ suite: "full", onFile: progress }));
  }
  log("evaluando gate (incluye suites R27)…");
  const evidence = await evaluateGate({ jobs });
  const out = path.resolve(arg("--out") || path.join(ROOT, "release", "evidence", "latest.gate.json"));
  writeJson(out, evidence);
  for (const c of evidence.criteria) {
    log(`${c.passed ? "✓" : "✗"} ${c.id} ${c.title}`);
    for (const k of c.checks) if (!k.passed) log(`    ✗ ${k.id}: ${k.detail}`);
  }
  log(`\n${evidence.status.toUpperCase()} — ${evidence.decision}`);
  for (const g of evidence.gaps) log(`  · [${g.id}] ${g.detail}`);
  log(`evidencia: ${path.relative(process.cwd(), out)}`);
  return evidence.status === "ready" ? 0 : 3;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    log(`error: ${err.code ? `${err.code}: ` : ""}${err.message}`);
    process.exit(1);
  }
);
