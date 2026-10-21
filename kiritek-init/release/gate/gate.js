"use strict";

/**
 * Gate de release de la iniciativa (T17). Junta resultados de jobs de la
 * matriz (`kiritek-init/test-job`), corre los chequeos estáticos y produce la
 * evidencia `kiritek-init/engineering-release-gate`:
 *
 *   status "ready"   todos los criterios T17.1–T17.7 pasan y no hay brechas;
 *   status "blocked" falta algo. Por R27.7 el pack sigue warning-only y la
 *                    evidencia documenta cada brecha con su dueño.
 *
 * `applyApproval` es lo único que publica: sólo acepta evidencia "ready" de
 * la revisión actual y escribe aprobación de suites (ligada a digest),
 * catálogo 2.0.0, pin de la plantilla y procedencia.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { CRITERIA, REQUIRED_JOBS } = require("./criteria.js");
const { ROOT, listTestFiles, gitRevision, gitDirty } = require("./jobs.js");

const PACK = (root) => path.join(root, "src", "engineering", "guardrails");
const CANDIDATE_REL = "release/candidates/engineering/guardrails/2.0.0";
const TEMPLATE_REL = "templates/engineering/guardrails/config/kiritek-engineering.config.json";
const PACK_CHANGELOG_REL = "docs/engineering/CHANGELOG.md";
const WORKFLOW_RELS = ["../.github/workflows/kiritek-init-ci.yml", "templates/engineering/guardrails/ci/github/kiritek-engineering.yml"];

const sha256 = (buf) => `sha256:${crypto.createHash("sha256").update(buf).digest("hex")}`;
const major = (v) => String(v).split(".")[0];

function check(id, passed, detail, extra = {}) {
  return { id, passed: !!passed, detail, ...extra };
}

// --- chequeos estáticos ---------------------------------------------------------------------

async function conformanceSuites(root) {
  const { SUITES, suiteDigest } = require(path.join(PACK(root), "conformance", "registry.js"));
  const { runConformance } = require(path.join(PACK(root), "conformance", "runner.js"));
  const suites = [];
  for (const controlId of Object.keys(SUITES)) {
    const r = await runConformance(controlId);
    const kinds = {};
    for (const c of r.cases) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    suites.push({ control: controlId, ref: r.ref, digest: suiteDigest(SUITES[controlId].slug, path.join(PACK(root), "conformance")), passed: r.passed, cases: r.cases.length, kinds, failed: r.cases.filter((c) => !c.passed).map((c) => c.id) });
  }
  const bad = suites.filter((s) => !s.passed);
  return { suites, result: check("conformance-suites", bad.length === 0, bad.length ? `fallan: ${bad.map((s) => `${s.ref} (${s.failed.join(", ")})`).join("; ")}` : `${suites.length} suites R27 pasan (${suites.reduce((n, s) => n + s.cases, 0)} casos)`) };
}

function loadCandidate(root) {
  const { readCatalogDir } = require(path.join(PACK(root), "catalog", "load.js"));
  const files = readCatalogDir(path.join(root, CANDIDATE_REL));
  return { files, doc: JSON.parse(files["catalog.json"].toString("utf8")) };
}

function candidateFailClosed(root, suiteRefs) {
  const { resolveCatalog } = require(path.join(PACK(root), "catalog", "resolve.js"));
  const rootDir = path.dirname(path.join(root, CANDIDATE_REL));
  const { doc } = loadCandidate(root);
  const problems = [];
  try {
    resolveCatalog({ version: doc.version, roots: [rootDir], approvedConformanceSuites: [] });
    problems.push("el candidato resuelve sin suites aprobadas");
  } catch (err) {
    if (err.code !== "CATALOG_CONFORMANCE_FAILED") problems.push(`sin aprobación falla con ${err.code || err.message}, no por conformidad`);
  }
  try {
    resolveCatalog({ version: doc.version, roots: [rootDir], approvedConformanceSuites: suiteRefs });
  } catch (err) {
    problems.push(`con las suites aprobadas no resuelve: ${err.code || err.message}`);
  }
  for (const ctl of doc.controls) {
    const ec = ctl.enforcementContract;
    if (!ec) continue;
    if (JSON.stringify(ec.evidenceTypes) !== JSON.stringify(["deterministic"])) problems.push(`${ctl.id}: evidencia apta para deny distinta de deterministic`);
    if (ec.moments.some((m) => m !== "pr" && m !== "release")) problems.push(`${ctl.id}: enforcement en momento local (${ec.moments.join(",")})`);
    if (ctl.defaults.level !== "warn") problems.push(`${ctl.id}: nivel por defecto ${ctl.defaults.level}`);
  }
  return check("candidate-fail-closed", problems.length === 0, problems.length ? problems.join("; ") : "sin aprobación el candidato no carga; enforce sólo con evidencia deterministic en pr/release; defaults warn");
}

function candidateReproducible() {
  const { buildCandidate } = require(path.join(ROOT, "scripts", "build-catalog-candidate.js"));
  const { files, doc } = buildCandidate();
  const disk = loadCandidate(ROOT).files;
  const same = Object.keys(files).length === Object.keys(disk).length && Object.entries(files).every(([rel, buf]) => disk[rel] && disk[rel].equals(buf));
  return check("candidate-reproducible", same, same ? `scripts/build-catalog-candidate.js reproduce ${doc.version} (${doc.digest})` : "el candidato en disco difiere del que produce el builder");
}

function candidateSemver(root) {
  const { resolveCatalog } = require(path.join(PACK(root), "catalog", "resolve.js"));
  const { diffCatalogs } = require(path.join(PACK(root), "catalog", "diff.js"));
  const { doc } = loadCandidate(root);
  const from = resolveCatalog({ version: "1.0.0" }).catalog;
  const d = diffCatalogs(from, doc);
  const problems = [...d.semverViolations];
  if (d.migrationError) problems.push(d.migrationError);
  if (d.controls.removed.length) problems.push(`retira controles: ${d.controls.removed.join(", ")}`);
  if (d.levelChanges.some((c) => c.field === "defaults.level")) problems.push("cambia niveles por defecto");
  return check("candidate-semver", problems.length === 0, problems.length ? problems.join("; ") : `1.0.0 → ${doc.version}: bump ${d.actualBump} (requerido ${d.requiredBump}), migraciones ${d.migrations.map((m) => `${m.from}→${m.to}`).join(", ")}`);
}

function releaseNotes(root) {
  const { doc, files } = loadCandidate(root);
  const missing = [];
  if (!files["notes/CHANGELOG.md"]) missing.push(`${CANDIDATE_REL}/notes/CHANGELOG.md`);
  for (const m of doc.migrations) if (!files[m.ref]) missing.push(`${CANDIDATE_REL}/${m.ref}`);
  const changelog = path.join(root, PACK_CHANGELOG_REL);
  if (!fs.existsSync(changelog)) missing.push(PACK_CHANGELOG_REL);
  else if (!fs.readFileSync(changelog, "utf8").includes(doc.version)) missing.push(`${PACK_CHANGELOG_REL} no menciona ${doc.version}`);
  return check("release-notes", missing.length === 0, missing.length ? `faltan: ${missing.join(", ")}` : "changelog del pack, changelog y migración del catálogo presentes");
}

function actionsPinned(root) {
  const problems = [];
  for (const rel of WORKFLOW_RELS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      problems.push(`${rel} no existe`);
      continue;
    }
    for (const m of fs.readFileSync(file, "utf8").matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (!/@[0-9a-f]{40}$/.test(m[1])) problems.push(`${rel}: ${m[1]} no está fijada por SHA`);
    }
  }
  return check("actions-pinned", problems.length === 0, problems.length ? problems.join("; ") : "todas las Actions fijadas por SHA de commit");
}

// --- jobs de la matriz ----------------------------------------------------------------------

function validJob(j) {
  return j && j.schemaVersion === 1 && j.kind === "kiritek-init/test-job" && typeof j.os === "string" && typeof j.node === "string" && Array.isArray(j.files);
}

function matrixCoverage(jobs, revision) {
  const current = jobs.filter((j) => j.revision === revision);
  const stale = jobs.filter((j) => j.revision !== revision).map((j) => `${j.os}/node${major(j.node)}/${j.suite} @ ${j.revision || "?"}`);
  const covered = [];
  const missing = [];
  const failing = [];
  for (const req of REQUIRED_JOBS) {
    const match = current.filter((j) => j.os === req.os && major(j.node) === req.node && (j.suite === req.suite || (req.suite === "engineering" && j.suite === "full")));
    const label = `${req.os}/node${req.node}/${req.suite}`;
    if (!match.length) missing.push(label);
    else if (match.some((j) => j.status === "pass")) covered.push(label);
    else failing.push(label);
  }
  return { covered, missing, failing, stale };
}

/** Resultado de un archivo de test en todos los jobs vigentes que lo corrieron. */
function fileOutcome(jobs, file) {
  const runs = [];
  for (const j of jobs) {
    const f = j.files.find((x) => x.file === file);
    if (f) runs.push({ job: `${j.os}/node${major(j.node)}/${j.suite}`, passed: f.fail === 0 && f.cancelled === 0 && f.exit === 0, pass: f.pass, skipped: f.skipped, failures: f.failures || [] });
  }
  return runs;
}

// --- evaluación -----------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {object[]} opts.jobs  Resultados `kiritek-init/test-job` (local + CI).
 * @param {string} [opts.root]
 * @param {() => string} [opts.now]
 * @param {object} [opts.overrides]  Sólo tests: reemplaza chequeos por id.
 */
async function evaluateGate({ jobs = [], root = ROOT, now = () => new Date().toISOString(), overrides = {} } = {}) {
  const revision = overrides.revision !== undefined ? overrides.revision : gitRevision(root);
  const dirty = overrides.dirty !== undefined ? overrides.dirty : gitDirty(root);
  const valid = jobs.filter(validJob);
  const current = valid.filter((j) => j.revision === revision);
  const gaps = [];

  const conf = overrides.conformance || (await conformanceSuites(root));
  const suiteRefs = conf.suites.map((s) => s.ref);
  const matrix = matrixCoverage(valid, revision);

  const engineeringFiles = listTestFiles("engineering", root).map((f) => f.replace(/^test\/engineering\//, ""));
  const assigned = new Set(CRITERIA.flatMap((c) => c.tests));
  const unassigned = engineeringFiles.filter((f) => !assigned.has(f));
  const unknown = [...assigned].filter((f) => !engineeringFiles.includes(f));

  const fullJobs = current.filter((j) => j.suite === "full");
  const external = new Map();
  for (const j of fullJobs) {
    for (const f of j.files) {
      if (f.file.startsWith("test/engineering/")) continue;
      if (f.fail || f.cancelled || f.exit) external.set(f.file, { file: f.file, job: `${j.os}/node${major(j.node)}`, failures: f.failures || [] });
    }
  }

  const statics = {
    "conformance-suites": () => conf.result,
    "candidate-fail-closed": () => candidateFailClosed(root, suiteRefs),
    "candidate-reproducible": () => candidateReproducible(),
    "candidate-semver": () => candidateSemver(root),
    "release-notes": () => releaseNotes(root),
    "actions-pinned": () => actionsPinned(root),
    "platform-matrix": () =>
      check(
        "platform-matrix",
        !matrix.missing.length && !matrix.failing.length,
        [matrix.covered.length && `cubiertos: ${matrix.covered.join(", ")}`, matrix.missing.length && `sin evidencia: ${matrix.missing.join(", ")}`, matrix.failing.length && `fallan: ${matrix.failing.join(", ")}`, matrix.stale.length && `ignorados por revisión distinta: ${matrix.stale.join(", ")}`].filter(Boolean).join("; ")
      ),
    "repo-suite": () =>
      check(
        "repo-suite",
        fullJobs.length > 0 && external.size === 0,
        !fullJobs.length ? "ningún job full de esta revisión" : external.size ? `fallan fuera de engineering: ${[...external.values()].map((e) => `${e.file} [${e.failures.join(" | ")}]`).join("; ")}` : `suite completa sin fallos en ${fullJobs.length} job(s)`
      ),
    "test-coverage": () => check("test-coverage", !unassigned.length && !unknown.length, unassigned.length || unknown.length ? [unassigned.length && `tests sin criterio: ${unassigned.join(", ")}`, unknown.length && `criterios citan tests inexistentes: ${unknown.join(", ")}`].filter(Boolean).join("; ") : `los ${engineeringFiles.length} archivos de test engineering están asignados a un criterio`),
    "worktree-clean": () => check("worktree-clean", dirty === false, dirty === false ? "árbol de kiritek-init limpio en la revisión evaluada" : "hay cambios sin commitear: la evidencia no corresponde a una revisión reproducible"),
  };

  const criteria = [];
  for (const c of CRITERIA) {
    const checks = [];
    for (const file of c.tests) {
      const runs = fileOutcome(current, `test/engineering/${file}`);
      const passed = runs.length > 0 && runs.every((r) => r.passed);
      const failed = runs.filter((r) => !r.passed);
      checks.push(check(`test:${file}`, passed, !runs.length ? "ningún job de esta revisión lo corrió" : failed.length ? `falla en ${failed.map((r) => `${r.job} [${r.failures.join(" | ")}]`).join("; ")}` : `pasa en ${runs.length} job(s)`, { runs: runs.map(({ failures, ...r }) => r) }));
    }
    for (const id of c.checks) checks.push(overrides[id] ? overrides[id] : statics[id]());
    criteria.push({ id: c.id, title: c.title, goals: c.goals, requirements: c.requirements, passed: checks.every((k) => k.passed), checks });
  }

  // Brechas con dueño, para documentar el estado warning-only (R27.7).
  if (matrix.missing.length) gaps.push({ id: "platform-matrix-missing", owner: "engineering/guardrails", detail: `sin evidencia de la matriz declarada: ${matrix.missing.join(", ")}`, remediation: "correr el workflow kiritek-init-ci en esta revisión y pasar sus artefactos con --jobs" });
  if (matrix.failing.length) gaps.push({ id: "platform-matrix-failing", owner: "engineering/guardrails", detail: `jobs en rojo: ${matrix.failing.join(", ")}` });
  for (const e of external.values()) gaps.push({ id: "repo-suite-external", owner: "fuera de engineering (dueño del archivo)", detail: `${e.file}: ${e.failures.join(" | ")}`, remediation: "corregir en su dominio; el gate no aprueba con la suite completa en rojo" });
  if (dirty !== false) gaps.push({ id: "worktree-dirty", owner: "release", detail: "árbol con cambios sin commitear", remediation: "commitear y repetir el gate sobre esa revisión" });
  for (const c of criteria) for (const k of c.checks) if (!k.passed && !["platform-matrix", "repo-suite", "worktree-clean"].includes(k.id)) gaps.push({ id: `${c.id}:${k.id}`, owner: "engineering/guardrails", detail: k.detail });

  const status = criteria.every((c) => c.passed) && gaps.length === 0 ? "ready" : "blocked";
  const { doc } = loadCandidate(root);
  return {
    schemaVersion: 1,
    kind: "kiritek-init/engineering-release-gate",
    generatedAt: now(),
    revision,
    worktreeDirty: dirty,
    status,
    decision: status === "ready" ? "Disponibilidad general: se puede aprobar (--approve)." : "Bloqueado: el pack sigue warning-only (R27.7) hasta cerrar las brechas.",
    candidate: { catalog: doc.id, version: doc.version, digest: doc.digest },
    suites: conf.suites,
    matrix: { required: REQUIRED_JOBS.map((j) => `${j.os}/node${j.node}/${j.suite}`), ...matrix },
    jobs: valid.map((j) => ({ os: j.os, node: j.node, suite: j.suite, revision: j.revision, status: j.status, totals: j.totals })),
    criteria,
    gaps,
    goalsNote: "G1–G7 no tienen texto en la spec; su lectura se infiere de tasks.md (release/gate/criteria.js).",
  };
}

// --- aprobación -----------------------------------------------------------------------------

/**
 * Publica el pack a partir de evidencia "ready". Escribe:
 *  - conformance/approved.json  suites con digest, fecha y evidencia;
 *  - catalogs/.../2.0.0          copia exacta del candidato;
 *  - plantilla de config         pin a 2.0.0 (instalaciones nuevas);
 *  - release/provenance/...      procedencia (digests de archivos, suites, evidencia).
 */
function applyApproval({ evidence, root = ROOT, now = () => new Date().toISOString(), revision = gitRevision(root) } = {}) {
  const refuse = (msg) => {
    const err = new Error(msg);
    err.code = "RELEASE_GATE_NOT_READY";
    throw err;
  };
  if (!evidence || evidence.kind !== "kiritek-init/engineering-release-gate") refuse("evidencia de gate inválida");
  if (evidence.status !== "ready") refuse(`el gate está ${evidence.status}: ${evidence.gaps.map((g) => g.id).join(", ")}`);
  if (evidence.revision !== revision) refuse(`la evidencia es de ${evidence.revision} y la revisión actual es ${revision}`);

  const { doc, files } = loadCandidate(root);
  if (doc.digest !== evidence.candidate.digest) refuse("el candidato cambió después del gate");
  const confDir = path.join(PACK(root), "conformance");
  const { SUITES, suiteDigest } = require(path.join(confDir, "registry.js"));
  const bySlug = new Map(Object.values(SUITES).map((s) => [`${s.id}@${s.version}`, s]));
  for (const s of evidence.suites) {
    if (!s.passed) refuse(`la suite ${s.ref} no pasó`);
    if (suiteDigest(bySlug.get(s.ref).slug, confDir) !== s.digest) refuse(`la suite ${s.ref} cambió después del gate`);
  }

  const approvedAt = now();
  const evidenceBuf = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const evidenceRel = `release/evidence/engineering-guardrails-${doc.version}.gate.json`;
  const write = (rel, buf) => {
    const target = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  };
  write(evidenceRel, evidenceBuf);

  const approvedFile = path.join(confDir, "approved.json");
  const approvedDoc = JSON.parse(fs.readFileSync(approvedFile, "utf8"));
  const keep = (approvedDoc.approved || []).filter((e) => !evidence.suites.some((s) => s.ref === e.ref));
  approvedDoc.approved = [...keep, ...evidence.suites.map((s) => ({ ref: s.ref, digest: s.digest, approvedAt, gateEvidenceRef: evidenceRel, gateEvidenceDigest: sha256(evidenceBuf) }))];
  fs.writeFileSync(approvedFile, `${JSON.stringify(approvedDoc, null, 2)}\n`);

  const catalogRel = `catalogs/engineering/guardrails/${doc.version}`;
  for (const [rel, buf] of Object.entries(files)) write(`${catalogRel}/${rel}`, buf);

  const tplFile = path.join(root, TEMPLATE_REL);
  const tpl = JSON.parse(fs.readFileSync(tplFile, "utf8"));
  const previousPin = tpl.pack.catalog;
  tpl.pack.catalog = doc.version;
  fs.writeFileSync(tplFile, `${JSON.stringify(tpl, null, 2)}\n`);

  const provenance = {
    schemaVersion: 1,
    kind: "kiritek-init/engineering-provenance",
    catalog: { id: doc.id, version: doc.version, digest: doc.digest, path: catalogRel },
    files: Object.keys(files).sort().map((rel) => ({ path: `${catalogRel}/${rel}`, digest: sha256(files[rel]) })),
    suites: evidence.suites.map((s) => ({ ref: s.ref, digest: s.digest })),
    template: { path: TEMPLATE_REL, from: previousPin, to: doc.version },
    builder: "node scripts/build-catalog-candidate.js",
    sourceRevision: revision,
    gateEvidence: { path: evidenceRel, digest: sha256(evidenceBuf) },
    approvedAt,
  };
  const provenanceRel = `release/provenance/engineering-guardrails-${doc.version}.json`;
  write(provenanceRel, Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`));
  return { catalog: catalogRel, provenance: provenanceRel, evidence: evidenceRel, approved: approvedDoc.approved.map((e) => e.ref) };
}

module.exports = { evaluateGate, applyApproval, matrixCoverage, fileOutcome, CANDIDATE_REL, TEMPLATE_REL };
