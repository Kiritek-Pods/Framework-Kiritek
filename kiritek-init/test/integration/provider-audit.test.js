"use strict";

/**
 * Tarea 41 — Auditar providers y proteger sus artefactos críticos (fase P).
 *
 * Valida los subtareas 41.1–41.4 sobre `audit/providers.js` y su cableado en
 * `audit/capabilities.js` + `audit/report.js`:
 *
 *   41.1 LOCAL present vs REMOTO observado/unauthorized/not-configured/
 *        not-applicable para CADA pack (github, aws-codecommit). Local =
 *        plantillas/plan presentes; remoto = observación de un probe inyectable
 *        (default no-network → unknown/not-configured). Pack no seleccionado =>
 *        not-applicable.
 *   41.2 DRIFT de rulesets/IAM/workflows/pins/owners SIN auto-corregir cloud:
 *        drift = estado remoto observado difiere del artefacto planificado; se
 *        REPORTA, nunca se corrige.
 *   41.3 Capacidades dependientes de plan/licencia/permisos y su FALLBACK
 *        (secret scanning requiere plan; ruleset vs branch protection);
 *        protección de cambios críticos por un OWNER DISTINTO cuando sea posible
 *        (reutiliza exceptions.assessRemoteOwnership / CODEOWNERS).
 *   41.4 Mocks de permisos/capacidades/drift y comparación de auditoría
 *        GitHub/AWS instalados por SEPARADO y JUNTOS sólo si la configuración lo
 *        permite.
 *
 * Sin red real ni secretos reales: transportes de observación/drift sintéticos
 * y presencia de credenciales simulada vía `env`.
 *
 * (Requisitos 14.5, 16, 17, 24.6, 27.3–27.6, 28.2, G.9–G.11.)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const prov = require("../../src/audit/providers.js");
const cap = require("../../src/audit/capabilities.js");
const report = require("../../src/audit/report.js");
const base = require("../../src/providers/base.js");
const providersRegistry = require("../../src/providers/index.js");
const { validateAgainst } = require("../../src/domain/schema-validator.js");
const { findCanaries } = require("../../src/scanners/redactor.js");

const PKG_ROOT = path.join(__dirname, "..", "..");
const FIXED_NOW = "2026-10-01T00:00:00.000Z";
const FIXED_DEPS = {
  clock: () => FIXED_NOW,
  idGenerator: () => "audit-plan-fixed",
  capabilityFactory: cap.capability,
};

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-prov-audit-"));
}

function findProvider(audit, pack) {
  return audit.capabilities.find((c) => c.id === `provider-${pack}`);
}

// ─────────────────────── 41.1 local vs remoto por pack ───────────────────────

test("41.1 pack NO seleccionado => not-applicable para ambos packs", () => {
  const repo = tmpRepo();
  try {
    const audit = cap.runCapabilityAudit(repo, { now: () => FIXED_NOW });
    for (const packName of providersRegistry.SUPPORTED) {
      const c = findProvider(audit, packName);
      assert.ok(c, `falta la capacidad del pack ${packName}`);
      assert.equal(c.applicable, false);
      assert.equal(c.observation, "not-applicable");
      assert.equal(report.statusOf(c), "not_applicable");
      assert.equal(c.provider.selected, false);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("41.1 local presente NO implica remoto: presencia local se detecta aparte de la observación", () => {
  // El repo del paquete tiene las plantillas del pack github => localPresent.
  const c = prov.auditProvider("github", {
    repoRoot: PKG_ROOT,
    env: {},
    selected: ["github"],
    ...FIXED_DEPS,
  });
  assert.equal(c.provider.localPresent, true);
  assert.equal(c.provider.localSource, "templates");
  assert.ok(c.provider.localArtifacts.length > 0);
  // Sin credencial ni transporte, el remoto NUNCA se afirma como observado.
  assert.notEqual(c.observation, "observed");
});

test("41.1 seleccionado, sin credencial, sin transporte => not-configured (nada que observar)", () => {
  const c = prov.auditProvider("github", {
    repoRoot: PKG_ROOT,
    env: {},
    selected: ["github"],
    ...FIXED_DEPS,
  });
  assert.equal(c.applicable, true);
  assert.equal(c.observation, "not-configured");
  assert.equal(report.statusOf(c), "missing");
});

test("41.1 seleccionado, con credencial, sin transporte => unknown (no se abre red)", () => {
  const c = prov.auditProvider("github", {
    repoRoot: PKG_ROOT,
    env: { GITHUB_TOKEN: "synthetic" },
    selected: ["github"],
    ...FIXED_DEPS,
  });
  assert.equal(c.observation, "unknown");
  assert.equal(report.statusOf(c), "unknown");
});

test("41.1 mock 200 => observed/ok; 403 => unauthorized/failed; 404 => not-configured/missing", () => {
  const mk = (transport) =>
    prov.auditProvider("github", {
      repoRoot: PKG_ROOT,
      env: { GITHUB_TOKEN: "x" },
      selected: ["github"],
      observe: transport,
      ...FIXED_DEPS,
    });

  const observed = mk(() => ({ httpStatus: 200 }));
  assert.equal(observed.observation, "observed");
  assert.equal(report.statusOf(observed), "ok");

  const unauthorized = mk(() => ({ httpStatus: 403 }));
  assert.equal(unauthorized.observation, "unauthorized");
  assert.equal(report.statusOf(unauthorized), "failed");
  assert.ok(unauthorized.provider.requiredPermissions.some((p) => p.status === "unauthorized"));

  const notConfigured = mk(() => ({ httpStatus: 404 }));
  assert.equal(notConfigured.observation, "not-configured");
  assert.equal(report.statusOf(notConfigured), "missing");

  // unauthorized y not-configured son estados DISTINTOS.
  assert.notEqual(unauthorized.observation, notConfigured.observation);
});

test("41.1 CodeCommit se audita por separado con el mismo contrato de estados", () => {
  const mk = (env, transport) =>
    prov.auditProvider("aws-codecommit", {
      repoRoot: PKG_ROOT,
      env,
      selected: ["aws-codecommit"],
      observe: transport,
      ...FIXED_DEPS,
    });
  assert.equal(mk({}, undefined).observation, "not-configured");
  assert.equal(mk({ AWS_PROFILE: "p" }, undefined).observation, "unknown");
  assert.equal(mk({ AWS_PROFILE: "p" }, () => ({ httpStatus: 200 })).observation, "observed");
  assert.equal(mk({ AWS_PROFILE: "p" }, () => ({ httpStatus: 403 })).observation, "unauthorized");
});

// ─────────────────────────── 41.2 drift sin corregir ─────────────────────────

test("41.2 sin driftProbe => drift NO se asume (checked=false, drift=false)", () => {
  const c = prov.auditProvider("github", {
    repoRoot: PKG_ROOT,
    env: { GITHUB_TOKEN: "x" },
    selected: ["github"],
    observe: () => ({ httpStatus: 200 }),
    ...FIXED_DEPS,
  });
  assert.equal(c.provider.drift.checked, false);
  assert.equal(c.drift, false);
});

test("41.2 drift detectado (observado != plan) => status drift y detalle del recurso, sin corregir", () => {
  const driftProbe = ({ resource }) =>
    resource === "branch-protection"
      ? { observed: true, matchesPlan: false, reason: "el ruleset remoto fue modificado fuera del plan" }
      : { observed: false };
  const c = prov.auditProvider("github", {
    repoRoot: PKG_ROOT,
    env: { GITHUB_TOKEN: "x" },
    selected: ["github"],
    observe: () => ({ httpStatus: 200 }),
    driftProbe,
    ...FIXED_DEPS,
  });
  assert.equal(c.drift, true);
  assert.equal(report.statusOf(c), "drift");
  assert.equal(c.provider.drift.checked, true);
  const detail = c.provider.drift.details.find((d) => d.resource === "branch-protection");
  assert.ok(detail);
  assert.equal(detail.observed, true);
  assert.equal(detail.matchesPlan, false);
  assert.equal(detail.drift, true);
  // El plan sigue siendo dry-run: nunca se corrige cloud.
  assert.equal(c.provider.dryRun, true);
  assert.equal(c.provider.applied, false);
  assert.match(c.provider.drift.reason, /sin auto-corregir|REPORTA/i);
});

test("41.2 sin drift (observado == plan) => no hay drift", () => {
  const driftProbe = () => ({ observed: true, matchesPlan: true });
  const c = prov.auditProvider("aws-codecommit", {
    repoRoot: PKG_ROOT,
    env: { AWS_PROFILE: "p" },
    selected: ["aws-codecommit"],
    observe: () => ({ httpStatus: 200 }),
    driftProbe,
    ...FIXED_DEPS,
  });
  assert.equal(c.drift, false);
  assert.equal(c.provider.drift.checked, true);
  assert.ok(c.provider.drift.details.every((d) => d.drift === false));
});

test("41.2 drift de IAM en CodeCommit se reporta (nunca se corrige)", () => {
  const driftProbe = ({ resource }) =>
    resource === "iam-policies"
      ? { observed: true, matchesPlan: false, reason: "política IAM remota más amplia que el plan" }
      : { observed: false };
  const c = prov.auditProvider("aws-codecommit", {
    repoRoot: PKG_ROOT,
    env: { AWS_PROFILE: "p" },
    selected: ["aws-codecommit"],
    observe: () => ({ httpStatus: 200 }),
    driftProbe,
    ...FIXED_DEPS,
  });
  assert.equal(c.drift, true);
  assert.equal(c.provider.applied, false);
});

// ───────────── 41.3 capacidades por plan/permisos + fallback + owner ──────────

test("41.3 GitHub expone capacidades dependientes de plan/permisos con su fallback", () => {
  const c = prov.auditProvider("github", {
    repoRoot: PKG_ROOT,
    env: {},
    selected: ["github"],
    ...FIXED_DEPS,
  });
  const gates = c.provider.capabilityGates;
  const byId = Object.fromEntries(gates.map((g) => [g.id, g]));
  // secret scanning depende de plan y su fallback es el core Gitleaks.
  assert.equal(byId["secret-scanning"].dependsOn, "plan");
  assert.equal(byId["secret-scanning"].fallback, "gitleaks-core");
  assert.match(byId["secret-scanning"].note, /Gitleaks/);
  // ruleset depende de permisos y su fallback es branch protection.
  assert.equal(byId["ruleset"].dependsOn, "permissions");
  assert.equal(byId["ruleset"].fallback, "branch-protection");
});

test("41.3 capability.available es honesta: unknown sin observar; noop observado => true", () => {
  // Sin observar: unknown.
  const unobserved = prov.auditProvider("github", {
    repoRoot: PKG_ROOT, env: {}, selected: ["github"], ...FIXED_DEPS,
  });
  assert.equal(
    unobserved.provider.capabilityGates.find((g) => g.id === "secret-scanning").available,
    "unknown"
  );
  // Observado ACTIVO (noop) => available true.
  const activeTransport = ({ resource }) =>
    resource === "secret-scanning" ? { status: base.OBSERVATION.OBSERVED, enabled: true } : { httpStatus: 404 };
  const observed = prov.auditProvider("github", {
    repoRoot: PKG_ROOT, env: { GITHUB_TOKEN: "x" }, selected: ["github"],
    observe: activeTransport, ...FIXED_DEPS,
  });
  assert.equal(
    observed.provider.capabilityGates.find((g) => g.id === "secret-scanning").available,
    true
  );
});

test("41.3 CodeCommit marca prevención de autoaprobación como dependiente con fallback de pool IAM", () => {
  const c = prov.auditProvider("aws-codecommit", {
    repoRoot: PKG_ROOT, env: {}, selected: ["aws-codecommit"], ...FIXED_DEPS,
  });
  const gate = c.provider.capabilityGates.find((g) => g.id === "approval-rule-self-approval-prevention");
  assert.ok(gate);
  assert.equal(gate.fallback, "iam-role-pool");
  assert.match(gate.note, /autoaprobaci|pool/i);
});

test("41.3 owner distinto: sin CODEOWNERS => no protegido con limitación honesta", () => {
  const repo = tmpRepo();
  try {
    const c = prov.auditProvider("github", {
      repoRoot: repo, env: {}, selected: ["github"], ...FIXED_DEPS,
    });
    assert.equal(c.provider.ownership.protected, false);
    assert.equal(c.provider.ownership.supported, false);
    assert.match(c.provider.ownership.reason, /CODEOWNERS|ownership/i);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("41.3 owner distinto: CODEOWNERS que cubre superficies sensibles => protegido", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(
      path.join(repo, "CODEOWNERS"),
      "/.kiritek/ @sec-team\n/.github/workflows/ @sec-team\nkiritek-security.config.json @sec-team\n"
    );
    const c = prov.auditProvider("github", {
      repoRoot: repo, env: {}, selected: ["github"], ...FIXED_DEPS,
    });
    assert.equal(c.provider.ownership.supported, true);
    assert.equal(c.provider.ownership.protected, true);
    assert.ok(c.provider.ownership.source.endsWith("CODEOWNERS"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ───────────── 41.4 por separado y juntos + schema + aislamiento + no-red ─────

test("41.4 auditoría de GitHub y AWS por SEPARADO: cada pack con su propio estado", () => {
  const gh = prov.auditProvider("github", {
    repoRoot: PKG_ROOT, env: { GITHUB_TOKEN: "x" }, selected: ["github"],
    observe: () => ({ httpStatus: 200 }), ...FIXED_DEPS,
  });
  const aws = prov.auditProvider("aws-codecommit", {
    repoRoot: PKG_ROOT, env: { AWS_PROFILE: "p" }, selected: ["aws-codecommit"],
    observe: () => ({ httpStatus: 403 }), ...FIXED_DEPS,
  });
  assert.equal(gh.observation, "observed");
  assert.equal(aws.observation, "unauthorized");
  // Auditar un pack no cambia el estado del otro (resultados independientes).
  assert.equal(gh.provider.pack, "github");
  assert.equal(aws.provider.pack, "aws-codecommit");
});

test("41.4 auditoría JUNTOS compone sin acoplar: estados independientes por pack", () => {
  const all = prov.auditAllProviders({
    repoRoot: PKG_ROOT,
    env: {},
    selected: ["github", "aws-codecommit"],
    observe: {
      github: () => ({ httpStatus: 200 }),
      "aws-codecommit": () => ({ httpStatus: 404 }),
    },
    ...FIXED_DEPS,
  });
  const gh = all.find((c) => c.id === "provider-github");
  const aws = all.find((c) => c.id === "provider-aws-codecommit");
  assert.equal(gh.observation, "observed");
  assert.equal(report.statusOf(gh), "ok");
  assert.equal(aws.observation, "not-configured");
  assert.equal(report.statusOf(aws), "missing");
});

test("41.4 selección parcial: sólo github aplicable; aws-codecommit queda not-applicable", () => {
  const audit = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github"],
    env: { GITHUB_TOKEN: "x" },
    providerObserve: () => ({ httpStatus: 200 }),
  });
  const gh = findProvider(audit, "github");
  const aws = findProvider(audit, "aws-codecommit");
  assert.equal(gh.applicable, true);
  assert.equal(gh.observation, "observed");
  assert.equal(aws.applicable, false);
  assert.equal(aws.observation, "not-applicable");
});

test("41.4 providerObserve por pack en el audit completo (mocks distintos por pack)", () => {
  const audit = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github", "aws-codecommit"],
    env: { GITHUB_TOKEN: "x", AWS_PROFILE: "p" },
    providerObserve: {
      github: () => ({ httpStatus: 403 }),
      "aws-codecommit": () => ({ httpStatus: 200 }),
    },
  });
  assert.equal(findProvider(audit, "github").observation, "unauthorized");
  assert.equal(findProvider(audit, "aws-codecommit").observation, "observed");
});

test("41.4 el audit con providers es schema-valid (provider añadido additivamente)", () => {
  const audit = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github", "aws-codecommit"],
    env: { GITHUB_TOKEN: "x", AWS_PROFILE: "p" },
    providerObserve: () => ({ httpStatus: 200 }),
    providerDriftProbe: () => ({ observed: true, matchesPlan: true }),
  });
  // renderAudit valida contra schema (lanza si inválido).
  const rendered = report.renderAudit(audit);
  assert.ok(typeof rendered.exitCode === "number");
  const parsed = JSON.parse(rendered.json);
  const gh = parsed.capabilities.find((c) => c.id === "provider-github");
  assert.equal(gh.provider.pack, "github");
  assert.ok(Array.isArray(gh.provider.capabilityGates));
});

test("41.4 determinismo: dos corridas idénticas producen el mismo resultado", () => {
  const run = () =>
    prov.auditProvider("github", {
      repoRoot: PKG_ROOT, env: { GITHUB_TOKEN: "x" }, selected: ["github"],
      observe: () => ({ httpStatus: 200 }), ...FIXED_DEPS,
    });
  assert.deepEqual(run(), run());
});

test("41.4 aislamiento: providers.js no importa el instalador del core ni acopla packs", () => {
  const src = fs.readFileSync(path.join(PKG_ROOT, "src", "audit", "providers.js"), "utf8");
  // No importa el instalador del core (auditar no instala nada).
  assert.equal(/require\(["'][^"']*install\//.test(src), false);
  assert.equal(/core-security/.test(src), false);
});

test("41.4 redacción: el token nunca aparece en la salida; sólo su presencia", () => {
  const CANARY = "ghp_000000000000000000000000000000000000";
  const audit = cap.runCapabilityAudit(PKG_ROOT, {
    now: () => FIXED_NOW,
    providers: ["github"],
    env: { GITHUB_TOKEN: CANARY },
    providerObserve: () => ({ httpStatus: 200 }),
  });
  const json = report.renderAudit(audit).json;
  assert.equal(json.includes(CANARY), false);
  assert.equal(findCanaries(json).length, 0);
});

test("41.4 el audit de providers NO abre red (observación por defecto, sin transporte)", () => {
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const calls = [];
  const originals = {
    httpReq: http.request, httpsReq: https.request,
    httpGet: http.get, httpsGet: https.get,
    connect: net.Socket.prototype.connect,
  };
  http.request = () => { calls.push("http.request"); throw new Error("red prohibida"); };
  https.request = () => { calls.push("https.request"); throw new Error("red prohibida"); };
  http.get = () => { calls.push("http.get"); throw new Error("red prohibida"); };
  https.get = () => { calls.push("https.get"); throw new Error("red prohibida"); };
  net.Socket.prototype.connect = function () { calls.push("socket.connect"); throw new Error("red prohibida"); };
  try {
    cap.runCapabilityAudit(PKG_ROOT, {
      now: () => FIXED_NOW,
      providers: ["github", "aws-codecommit"],
      env: { GITHUB_TOKEN: "x", AWS_PROFILE: "p" },
    });
  } finally {
    http.request = originals.httpReq;
    https.request = originals.httpsReq;
    http.get = originals.httpGet;
    https.get = originals.httpsGet;
    net.Socket.prototype.connect = originals.connect;
  }
  assert.deepEqual(calls, []);
});
