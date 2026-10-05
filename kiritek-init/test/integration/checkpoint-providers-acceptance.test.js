"use strict";

/**
 * Checkpoint 42 (CP) — "Aceptar providers sin autoaplicar infraestructura".
 *
 * Este test es la DEMOSTRACIÓN CONSOLIDADA del gate de la fase P (providers).
 * No reimplementa lógica de provider: ejercita, de punta a punta y en UN SOLO
 * lugar, las piezas construidas en las tareas 38–41 y comprueba las propiedades
 * de gobernanza del checkpoint sobre el MISMO repositorio.
 *
 * A diferencia de las suites puntuales 38–41 (que validan cada pieza por
 * separado), este checkpoint demuestra las propiedades del gate JUNTAS,
 * cerrando la brecha que ninguna suite previa cubría de forma explícita: una
 * aceptación consolidada que instala el core, corre GitHub (plan+audit) y AWS
 * (plan+audit) en el MISMO repo, bajo UNA SOLA intercepción de red que abarca
 * AMBOS flujos, y afirma como un único gate que:
 *
 *   42.1 — Instalación/plan/audit de GitHub y AWS por SEPARADO; el CORE y el
 *          provider OPUESTO no cambian (aislamiento de packs + core intacto).
 *   42.2 — Permisos, SHA pins, forks, IAM mínimo privilegio, approvals,
 *          rollback y estados no-autorizado/no-configurado presentes en los
 *          planes/auditorías emitidos.
 *   42.3 — Por logs/mocks: NINGUNA llamada cloud mutante ocurrió en todo el
 *          flujo (dry-run; apply exige confirmación humana fuera del plan).
 *
 * Gate providers: G.8 (CI sin push / pins / comandos core), G.9 (providers
 * instalables por separado, sin auto-apply), G.10 (límites de incidente/rama
 * default honestos), G.12 (sin fugas).
 *
 * Todo es sintético: sin red real, sin secretos reales. Las "credenciales" son
 * marcadores con forma de canario que SÓLO viven en el contexto de prueba, y
 * las observaciones remotas son transportes mock inyectados.
 *
 * (Requisitos 16–17, 24, 26.9, G.8–G.10, G.12.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const coreInstall = require("../../src/install/core-security.js");
const inventory = require("../../src/install/inventory.js");
const base = require("../../src/providers/base.js");
const providers = require("../../src/providers/index.js");
const github = require("../../src/providers/github.js");
const codecommit = require("../../src/providers/codecommit.js");
const { lintWorkflow } = require("../../src/providers/github-workflow-lint.js");
const iamLint = require("../../src/providers/codecommit-iam-lint.js");
const cap = require("../../src/audit/capabilities.js");
const report = require("../../src/audit/report.js");
const { validateAgainst } = require("../../src/domain/schema-validator.js");
const { findCanaries, safeSerialize } = require("../../src/scanners/redactor.js");

const PKG_ROOT = path.join(__dirname, "..", "..");
const FIXED_NOW = "2026-10-01T00:00:00.000Z";
const FIXED_DEPS = {
  clock: () => "2026-10-01T12:00:00.000Z",
  idGenerator: () => "cp42-fixed-id",
};

// Material SINTÉTICO (ninguno es real). Forma de canario para probar que ninguna
// superficie del flujo de providers lo filtra en el barrido consolidado.
const SYNTH_GH_TOKEN = "ghp_000000000000000000000000000000000000";
const SYNTH_AWS_KEY = "AKIAPROVIDERSCANARY001";
const SYNTH_AWS_SECRET = "providersCANARYsecret0000000000000000000x";
// Entorno AWS que SÍ cuenta como credencial (access key + secret) para que la
// observación sea `unknown` (credencial presente, sin transporte) en vez de
// `not-configured`.
const AWS_CRED_ENV = { AWS_ACCESS_KEY_ID: SYNTH_AWS_KEY, AWS_SECRET_ACCESS_KEY: SYNTH_AWS_SECRET };

/** realpath para que /var vs /private/var en macOS no confunda al reconciliador. */
function tmpRepo(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `kiritek-cp42-${prefix}-`)));
}

/** Snapshot recursivo {rutaRelativa -> contenido} de un árbol de archivos. */
function snapshotTree(root) {
  const out = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out[rel] = fs.readFileSync(abs, "utf8");
    }
  }
  walk(root);
  return out;
}

/** Instala el core en un repo Git nuevo y devuelve {repo, result, tree}. */
function installCoreRepo(prefix) {
  const repo = tmpRepo(prefix);
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const result = coreInstall.installCore({ repoRoot: repo });
  return { repo, result, tree: snapshotTree(repo) };
}

/**
 * Instala TODAS las trampas de red de Node y devuelve un controlador. Si algún
 * punto de red se invoca, se registra Y se lanza (una llamada mutante real
 * usaría la red). Mientras esté activo, NINGUNA red está permitida.
 */
function installNetworkTrap() {
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const dns = require("node:dns");
  const calls = [];
  const originals = {
    httpReq: http.request,
    httpsReq: https.request,
    httpGet: http.get,
    httpsGet: https.get,
    connect: net.Socket.prototype.connect,
    dnsLookup: dns.lookup,
    dnsPromisesLookup: dns.promises && dns.promises.lookup,
  };
  const trap = (name) => (...args) => {
    calls.push(name);
    throw new Error(`llamada de red prohibida en el flujo de providers: ${name}`);
  };
  http.request = trap("http.request");
  https.request = trap("https.request");
  http.get = trap("http.get");
  https.get = trap("https.get");
  net.Socket.prototype.connect = function () {
    calls.push("socket.connect");
    throw new Error("llamada de red prohibida en el flujo de providers: socket.connect");
  };
  dns.lookup = trap("dns.lookup");
  if (dns.promises) dns.promises.lookup = trap("dns.promises.lookup");
  return {
    calls,
    restore() {
      http.request = originals.httpReq;
      https.request = originals.httpsReq;
      http.get = originals.httpGet;
      https.get = originals.httpsGet;
      net.Socket.prototype.connect = originals.connect;
      dns.lookup = originals.dnsLookup;
      if (dns.promises && originals.dnsPromisesLookup) dns.promises.lookup = originals.dnsPromisesLookup;
    },
  };
}

// ===========================================================================
// 42.1 — instalación/plan/audit por SEPARADO; core y provider opuesto intactos
// ===========================================================================

test("42.1 instalar el core NO instala NINGÚN provider (packs no se auto-seleccionan)", () => {
  const { repo, result } = installCoreRepo("core");
  try {
    assert.equal(result.installed, true, "el core se instaló");
    // El inventario del core NO contiene ningún artefacto de provider.
    const inv = JSON.parse(fs.readFileSync(path.join(repo, inventory.INVENTORY_FILENAME), "utf8"));
    const entries = inv.entries || {};
    for (const [rel, meta] of Object.entries(entries)) {
      assert.equal(
        /github|codecommit|aws/i.test(meta.owner || ""),
        false,
        `el core no debe poseer artefactos de provider (owner=${meta.owner} en ${rel})`
      );
    }
    // Ningún archivo de provider aparece en el árbol tras instalar sólo el core.
    const tree = snapshotTree(repo);
    for (const rel of Object.keys(tree)) {
      assert.equal(
        /providers\/(github|aws-codecommit)|ruleset\.json|iam-least-privilege/.test(rel),
        false,
        `instalar el core no debe materializar artefactos de provider (${rel})`
      );
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("42.1 planificar GitHub y AWS en el MISMO repo NO muta el árbol del core (plan ≠ apply)", () => {
  const { repo, tree: before } = installCoreRepo("plan");
  try {
    // Generar planes de AMBOS providers sobre el mismo repo del core.
    const ghPlan = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: SYNTH_GH_TOKEN } }), FIXED_DEPS);
    const awsPlan = base.buildPlan(codecommit.generate({ env: AWS_CRED_ENV }), FIXED_DEPS);

    // El árbol del repo es BYTE-idéntico antes y después: un plan no aplica nada.
    const after = snapshotTree(repo);
    assert.deepEqual(after, before, "generar planes no debe mutar el árbol del core");

    // Ambos planes son dry-run, no aplicados, y exigen confirmación humana fuera.
    for (const plan of [ghPlan, awsPlan]) {
      assert.equal(plan.dryRun, true);
      assert.equal(plan.applied, false);
      assert.equal(plan.apply.supported, false);
      assert.equal(plan.apply.requiresHumanConfirmation, true);
      assert.equal(validateAgainst("provider-plan", JSON.parse(JSON.stringify(plan))).valid, true);
    }
    // Aislamiento: cada plan reclama SÓLO su provider.
    assert.equal(ghPlan.provider, "github");
    assert.equal(awsPlan.provider, "aws-codecommit");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("42.1 auditar un provider deja al OPUESTO en not-applicable (sin acoplar packs)", () => {
  // Selección SÓLO github → aws-codecommit queda not-applicable, y viceversa.
  const onlyGithub = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github"],
    env: { GITHUB_TOKEN: "x" },
    providerObserve: () => ({ httpStatus: 200 }),
  });
  const ghA = onlyGithub.capabilities.find((c) => c.id === "provider-github");
  const awsA = onlyGithub.capabilities.find((c) => c.id === "provider-aws-codecommit");
  assert.equal(ghA.applicable, true);
  assert.equal(ghA.observation, "observed");
  assert.equal(awsA.applicable, false);
  assert.equal(awsA.observation, "not-applicable");

  const onlyAws = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["aws-codecommit"],
    env: { AWS_PROFILE: "p" },
    providerObserve: () => ({ httpStatus: 200 }),
  });
  const ghB = onlyAws.capabilities.find((c) => c.id === "provider-github");
  const awsB = onlyAws.capabilities.find((c) => c.id === "provider-aws-codecommit");
  assert.equal(awsB.applicable, true);
  assert.equal(awsB.observation, "observed");
  assert.equal(ghB.applicable, false);
  assert.equal(ghB.observation, "not-applicable");
});

test("42.1 las capacidades CORE son idénticas con o sin providers seleccionados (core no cambia)", () => {
  const coreOnly = cap.runCapabilityAudit(PKG_ROOT, { now: () => FIXED_NOW });
  const withProviders = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github", "aws-codecommit"],
    env: { GITHUB_TOKEN: "x", AWS_PROFILE: "p" },
    providerObserve: () => ({ httpStatus: 200 }),
  });

  const coreIds = (audit) =>
    audit.capabilities.filter((c) => !c.id.startsWith("provider-")).map((c) => c.id);
  const pick = (audit) =>
    audit.capabilities
      .filter((c) => !c.id.startsWith("provider-"))
      .map((c) => ({ id: c.id, applicable: c.applicable, status: report.statusOf(c) }));

  // Mismo conjunto de capacidades core, mismo estado por capa: añadir providers
  // es ADITIVO y no toca el core.
  assert.deepEqual(coreIds(withProviders), coreIds(coreOnly));
  assert.deepEqual(pick(withProviders), pick(coreOnly));
  // Las capacidades de provider sólo aparecen cuando se seleccionan.
  assert.equal(coreOnly.capabilities.some((c) => c.id.startsWith("provider-")), true,
    "las capacidades de provider existen como not-applicable incluso sin selección");
});

// ===========================================================================
// 42.2 — permisos, pins, forks, IAM, approvals, rollback, estados en los planes
// ===========================================================================

test("42.2 GitHub: SHA pins, permisos mínimos, forks seguros y comandos core en el workflow emitido", () => {
  const wf = fs.readFileSync(
    path.join(PKG_ROOT, "templates", "providers", "github", "workflows", "kiritek-security.yml"),
    "utf8"
  );
  // El linter de endurecimiento (SHA pin / permisos / fork / comando core / sin push).
  assert.equal(lintWorkflow(wf).ok, true);
  // Pins explícitos por SHA de 40 hex.
  const uses = wf.split("\n").filter((l) => /uses:/.test(l));
  assert.ok(uses.length > 0);
  for (const line of uses) {
    const m = line.match(/@(\S+)/);
    assert.ok(m && /^[0-9a-f]{40}$/.test(m[1]), `action no fijada por SHA: ${line.trim()}`);
  }
  // Invoca el core y nunca pull_request_target ni git push (G.8).
  assert.match(wf, /kiritek-init scan/);
  assert.equal(/pull_request_target/.test(wf), false);
  assert.equal(/git\s+push/.test(wf), false);
});

test("42.2 GitHub: el plan diferencia unauthorized (403) de not-configured (404)", () => {
  const p403 = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: () => ({ httpStatus: 403 }) }), FIXED_DEPS);
  const p404 = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: "x" }, observe: () => ({ httpStatus: 404 }) }), FIXED_DEPS);
  assert.equal(p403.observation, "unauthorized");
  assert.equal(p404.observation, "not-configured");
  assert.notEqual(p403.observation, p404.observation);
  assert.ok(p403.requiredPermissions.some((perm) => perm.status === "unauthorized"));
  // Rollback presente y nada aplicado.
  assert.ok(p403.rollback.length >= 1);
  assert.equal(p403.applied, false);
});

test("42.2 AWS: IAM mínimo privilegio + approvals + pipeline + rollback + límite feature-branch (G.10)", () => {
  const plan = base.buildPlan(codecommit.generate({ env: AWS_CRED_ENV }), FIXED_DEPS);
  const byId = Object.fromEntries(plan.changes.map((c) => [c.id, c]));

  // IAM mínimo privilegio sobre la rama default; nombra las acciones destructivas.
  const iam = byId["iam-least-privilege-default-branch"];
  assert.ok(iam);
  assert.match(iam.description, /MÍNIMO PRIVILEGIO/);
  assert.match(iam.description, /rama default|branch/i);
  for (const action of codecommit.DESTRUCTIVE_ACTIONS) {
    assert.match(iam.description, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  // Approval rule (revisores mínimos / separación de funciones).
  assert.ok(byId["approval-rule-default-branch"]);
  // Pipeline con gates core y aprobación manual antes de producción.
  assert.ok(byId["pipeline-core-gates"]);
  // Límite honesto (G.10): IAM sobre default NO protege feature branches.
  const limit = byId["limitation-default-branch-vs-feature"];
  assert.ok(limit);
  assert.match(limit.description, /feature branch/i);
  assert.match(limit.description, /local|pre-push|CI/i);

  // Rollback por stack.
  const rbIds = plan.rollback.map((r) => r.id);
  for (const id of ["rollback-iam", "rollback-approval-rule", "rollback-pipeline"]) {
    assert.ok(rbIds.includes(id), `falta ${id}`);
  }
  assert.equal(plan.applied, false);
});

test("42.2 AWS: la plantilla IAM pasa el análisis estático de mínimo privilegio", () => {
  const text = fs.readFileSync(
    path.join(PKG_ROOT, "templates", "providers", "aws-codecommit", "iam-least-privilege.yaml"),
    "utf8"
  );
  const res = iamLint.lintTemplateText(text, { requirePolicy: true, requireRestriction: true });
  assert.equal(res.ok, true, JSON.stringify(res.violations));
});

// ===========================================================================
// 42.3 — CERO llamadas cloud mutantes a lo largo de TODO el flujo (una sola trampa)
// ===========================================================================

test("42.3 flujo consolidado: core install + GitHub(plan+audit) + AWS(plan+audit) sin NINGUNA llamada de red", () => {
  const repo = tmpRepo("flow");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const trap = installNetworkTrap();
  const emitted = [];
  try {
    // (1) Instalar el core.
    const coreResult = coreInstall.installCore({ repoRoot: repo });
    emitted.push(safeSerialize(coreResult).json);
    assert.equal(coreResult.installed, true);

    // (2) GitHub: plan + auditoría (observación por defecto, SIN transporte → sin red).
    const ghPlan = base.buildPlan(github.generate({ env: { GITHUB_TOKEN: SYNTH_GH_TOKEN } }), FIXED_DEPS);
    emitted.push(JSON.stringify(ghPlan));
    const ghAudit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      providers: ["github"],
      env: { GITHUB_TOKEN: SYNTH_GH_TOKEN },
    });
    emitted.push(report.renderAudit(ghAudit).json);

    // (3) AWS: plan + auditoría en el MISMO repo (sin transporte → sin red).
    const awsPlan = base.buildPlan(codecommit.generate({ env: AWS_CRED_ENV }), FIXED_DEPS);
    emitted.push(JSON.stringify(awsPlan));
    const awsAudit = cap.runCapabilityAudit(repo, {
      now: () => FIXED_NOW,
      providers: ["aws-codecommit"],
      env: AWS_CRED_ENV,
    });
    emitted.push(report.renderAudit(awsAudit).json);

    // Sin credencial, el estado es not-configured; con credencial sin transporte,
    // unknown — NUNCA observed (nada se afirma sin observar de verdad).
    const ghCap = ghAudit.capabilities.find((c) => c.id === "provider-github");
    const awsCap = awsAudit.capabilities.find((c) => c.id === "provider-aws-codecommit");
    assert.equal(ghCap.observation, "unknown");
    assert.equal(awsCap.observation, "unknown");
  } finally {
    trap.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  }

  // Prueba por "logs": CERO llamadas de red registradas en todo el flujo.
  assert.deepEqual(trap.calls, [], `se detectaron llamadas de red: ${trap.calls.join(", ")}`);

  // Barrido consolidado anti-fuga (G.12): ni los tokens sintéticos ni canarios.
  const all = emitted.join("\n");
  assert.equal(all.includes(SYNTH_GH_TOKEN), false, "el token de GitHub sintético no debe aparecer");
  assert.equal(all.includes(SYNTH_AWS_KEY), false, "la clave AWS sintética no debe aparecer");
  assert.equal(all.includes(SYNTH_AWS_SECRET), false, "el secreto AWS sintético no debe aparecer");
  assert.deepEqual(findCanaries(all), [], "ninguna salida del flujo de providers debe filtrar un canario");
});

test("42.3 observar con transporte mock tampoco abre red real (observación inyectada)", () => {
  const trap = installNetworkTrap();
  let ghObs = null;
  let awsObs = null;
  try {
    // Transportes mock: devuelven estado SIN tocar la red real.
    ghObs = base.buildPlan(
      github.generate({ env: { GITHUB_TOKEN: "x" }, observe: () => ({ httpStatus: 200 }) }),
      FIXED_DEPS
    ).observation;
    awsObs = base.buildPlan(
      codecommit.generate({ env: { AWS_PROFILE: "p" }, observe: () => ({ httpStatus: 403 }) }),
      FIXED_DEPS
    ).observation;
  } finally {
    trap.restore();
  }
  assert.equal(ghObs, "observed");
  assert.equal(awsObs, "unauthorized");
  assert.deepEqual(trap.calls, [], "un transporte mock no debe abrir red real");
});

// ===========================================================================
// Barrido consolidado del checkpoint (G.12): nada de lo que este CP ejercita filtra
// ===========================================================================

test("CP G.12: barrido consolidado — ninguna salida del checkpoint 42 filtra un canario", () => {
  const chunks = [];

  // Planes de ambos providers con credenciales sintéticas embebidas.
  chunks.push(JSON.stringify(base.buildPlan(github.generate({ env: { GITHUB_TOKEN: SYNTH_GH_TOKEN } }), FIXED_DEPS)));
  chunks.push(JSON.stringify(base.buildPlan(codecommit.generate({ env: AWS_CRED_ENV }), FIXED_DEPS)));

  // Auditoría de providers con tokens sintéticos en el entorno.
  const audit = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github", "aws-codecommit"],
    env: { GITHUB_TOKEN: SYNTH_GH_TOKEN, ...AWS_CRED_ENV },
    providerObserve: () => ({ httpStatus: 200 }),
  });
  const rendered = report.renderAudit(audit);
  chunks.push(rendered.json, rendered.human);

  // Plantillas endurecidas de ambos packs.
  chunks.push(
    fs.readFileSync(path.join(PKG_ROOT, "templates", "providers", "github", "workflows", "kiritek-security.yml"), "utf8"),
    fs.readFileSync(path.join(PKG_ROOT, "templates", "providers", "github", "CODEOWNERS"), "utf8"),
    fs.readFileSync(path.join(PKG_ROOT, "templates", "providers", "aws-codecommit", "iam-least-privilege.yaml"), "utf8")
  );

  const all = chunks.join("\n");
  assert.equal(all.includes(SYNTH_GH_TOKEN), false, "el token de GitHub sintético no debe aparecer");
  assert.equal(all.includes(SYNTH_AWS_KEY), false, "la clave AWS sintética no debe aparecer");
  assert.equal(all.includes(SYNTH_AWS_SECRET), false, "el secreto AWS sintético no debe aparecer");
  assert.deepEqual(findCanaries(all), [], "ningún canario reconocible en la salida consolidada del CP 42");
});
