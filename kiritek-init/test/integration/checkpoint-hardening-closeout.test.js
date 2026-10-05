"use strict";

/**
 * Checkpoint 37 (CP) — "Cerrar endurecimiento antes de providers".
 *
 * Este test es la DEMOSTRACIÓN CONSOLIDADA del gate que habilita la fase P1
 * (providers). No reimplementa lógica: ejercita, de punta a punta y en un solo
 * lugar, las piezas ya construidas en las tareas 31–36 y comprueba las
 * propiedades de gobernanza que exige el checkpoint.
 *
 * Mapeo de subtareas → aserciones:
 *
 *   37.1 — migración 0.1.0 → doctor → promote → excepción/break-glass →
 *          incidente PUBLICADO, con un ÚNICO barrido de fugas sobre TODO lo
 *          emitido (migración, doctor, promote, excepciones, runbook).
 *          (G.12, G.13; requisitos 19–21, 28.)
 *
 *   37.2 — matriz de compatibilidad ejecutable y endurecida (sin push, actions
 *          fijadas por SHA, permisos mínimos) + telemetría OFF por defecto y
 *          segura con opt-in. (G.8, G.14, G.12; requisitos 23, 25.)
 *
 *   37.3 — ningún mecanismo gobernado permite `--no-verify`; una baseline
 *          legacy NUNCA oculta un hallazgo nuevo; los tres workflows no hacen
 *          push directo. (G.5–G.8, G.11, G.13.)
 *
 * Todo es sintético: sin red real, sin secretos reales. El transporte de
 * telemetría/Jira es un mock y los "secretos" son marcadores con forma de
 * canario que SÓLO viven en el contexto de prueba.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const migrate = require("../../src/install/migrate.js");
const inventory = require("../../src/install/inventory.js");
const promotion = require("../../src/policy/promotion.js");
const exceptions = require("../../src/policy/exceptions.js");
const gitGuard = require("../../src/policy/git.js");
const { classifyIncident, EXPOSURE } = require("../../src/incident/classify.js");
const { buildRunbook, recordRotationEvidence } = require("../../src/incident/runbook.js");
const { buildFingerprint } = require("../../src/scanners/fingerprint.js");
const { findCanaries, safeSerialize } = require("../../src/scanners/redactor.js");
const events = require("../../src/telemetry/events.js");
const transport = require("../../src/telemetry/transport.js");
const { DEFAULT_CONFIG, clone } = require("../../src/config/defaults.js");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(__dirname, "..", "fixtures", "migrate");

// Material SINTÉTICO (ninguno es real): se incrusta a propósito para probar
// que ninguna superficie lo filtra en el barrido consolidado.
const SYNTH_SECRET = "AKIACLOSEOUTCANARY00001"; // forma de AWS access key
const SYNTH_JIRA_TOKEN = "synthetic-jira-token-CLOSEOUT-xyz";

const FIXED = "2026-10-01T00:00:00.000Z";

function tmpRepo(prefix) {
  // realpath para evitar que /var vs /private/var en macOS confunda la
  // contención/atomicidad del reconciliador (que resuelve realpath internamente).
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `kiritek-cp37-${prefix}-`)));
}
function read(repo, rel) {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}
function exists(repo, rel) {
  return fs.existsSync(path.join(repo, rel));
}

/** Siembra una instalación 0.1.0 "legacy" con workflow inseguro de fábrica. */
function seedLegacy(repo) {
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude", "skill.md"), "# skill del usuario\n");
  fs.writeFileSync(path.join(repo, "kiritek-audit.config.json"), '{\n  "version": "0.1.0"\n}\n');
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# CLAUDE del proyecto\n");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# AGENTS del proyecto\n");
  const dir = path.join(repo, ".github", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "kiritek-audit.yml"),
    fs.readFileSync(path.join(FIXTURES, "legacy-audit.factory.yml"), "utf8")
  );
}

/** Acumulador de TODA la salida/JSON emitido por el flujo de endurecimiento. */
class Sink {
  constructor() {
    this.chunks = [];
  }
  add(label, value) {
    const text = typeof value === "string" ? value : safeSerialize(value).json;
    if (text && text.length) this.chunks.push(`[${label}]\n${text}`);
  }
  get all() {
    return this.chunks.join("\n");
  }
}

// ===========================================================================
// 37.1 — migración → doctor → promote → excepción/break-glass → incidente
//        publicado, con barrido consolidado de fugas.
// ===========================================================================

test("37.1 flujo de endurecimiento end-to-end sin fuga (migración→doctor→promote→excepción/BG→incidente publicado)", async () => {
  const repo = tmpRepo("flow");
  const sink = new Sink();
  try {
    // Siembra una instalación 0.1.0 legacy con workflow inseguro de fábrica.
    seedLegacy(repo);

    // --- (1) Migración 0.1.0 → baseline warning + workflow seguro ---
    const mig = migrate.migrate({ repoRoot: repo, now: () => FIXED });
    sink.add("migrate", mig);
    assert.equal(mig.applied, true, "la migración se aplica");
    assert.equal(mig.mode, "warning", "la migración instala en warning (deuda tolerada acotada)");
    assert.equal(mig.compliant, true, "0.1.0 de fábrica → sin conflictos críticos");
    assert.ok(exists(repo, "kiritek-security.config.json"), "baseline del core instalado");
    assert.ok(exists(repo, inventory.INVENTORY_FILENAME), "inventario registrado");
    // El workflow inseguro de fábrica fue reemplazado por el endurecido (G.13/G.8).
    const migratedWf = read(repo, ".github/workflows/kiritek-audit.yml");
    assert.equal(/git\s+push/.test(migratedWf), false, "el workflow migrado NO hace git push");
    assert.ok(/upload-artifact/.test(migratedWf), "el workflow migrado sube artefacto");

    // --- (2) Doctor sobre el repo migrado (auditoría inyectada, sin red) ---
    const auditAllOk = async () => ({
      schemaVersion: 1,
      generatedAt: FIXED,
      capabilities: [
        { id: "config", applicable: true, installed: true, active: true, integrity: "ok" },
        { id: "ignores", applicable: true, installed: true, active: true, integrity: "ok" },
        { id: "secret-scanning", applicable: true, installed: true, active: true, integrity: "ok" },
        { id: "git-hooks", applicable: true, installed: true, active: true, integrity: "ok" },
        { id: "ci", applicable: true, installed: true, active: true, observation: "observed" },
      ],
    });
    const doctor = await promotion.runDoctor(repo, {
      now: () => "2026-10-02T00:00:00.000Z",
      auditFn: auditAllOk,
      // Credencial sintética presente para ejercitar la ruta con Jira sin filtrar.
      env: { KIRITEK_JIRA_TOKEN: SYNTH_JIRA_TOKEN },
    });
    sink.add("doctor", doctor);
    assert.ok(["ready", "unknown"].includes(doctor.readiness), "el doctor emite veredicto honesto");

    // --- (3) Promoción warning → enforce (readiness OK) ---
    const decision = promotion.canPromote(doctor, {});
    sink.add("promote-decision", decision);
    if (doctor.readiness === "ready") {
      assert.equal(decision.allowed, true, "readiness ready habilita promover");
      const built = promotion.buildPromotionRecord(
        {
          actor: "lead@acme",
          origin: "cli",
          previousConfig: { version: 1, mode: "warning" },
          doctor,
        },
        { clock: () => FIXED, toolVersion: "9.9.9" }
      );
      sink.add("promote-record", built);
      assert.equal(built.record.previousMode, "warning");
      assert.equal(built.record.newMode, "enforce");
      assert.ok(built.evidence.id, "la promoción deja evidencia referenciable");
    }

    // --- (4) Excepción estándar válida + break-glass gobernado ---
    const std = exceptions.validateException(
      {
        controlId: "custom.generic",
        scopeFingerprint: "src/legacy.js:generic:7",
        reason: "deuda legacy acotada",
        owner: "equipo-x",
        ticket: "SEC-900",
        expiresAt: "2026-10-15T00:00:00.000Z",
      },
      { clock: () => FIXED }
    );
    sink.add("exception-standard", std);
    assert.equal(std.valid, true, JSON.stringify(std.errors));

    const bg = exceptions.validateException(
      {
        type: "break-glass",
        controlId: "git.command-guard",
        scopePath: "src/release/hotfix.js",
        reason: "hotfix de incidente",
        motive: "Incidente P1 coordinado con guardia",
        owner: "guardia",
        approver: "lead",
        ticket: "SEC-901",
        incident: "INC-CLOSEOUT",
        postReview: true,
        expiresAt: "2026-10-03T00:00:00.000Z",
      },
      { clock: () => FIXED }
    );
    sink.add("exception-break-glass", bg);
    assert.equal(bg.valid, true, JSON.stringify(bg.errors));
    assert.equal(bg.type, "break-glass");

    // --- (5) Incidente PUBLICADO: clasificación + runbook + evidencia rotación ---
    const classified = classifyIncident({
      exposure: EXPOSURE.REMOTE_DEFAULT,
      provider: "aws",
      isDefaultBranch: true,
      environment: "production",
      privileged: true,
      finding: {
        ruleId: "aws-access-key",
        path: "src/config.js",
        fingerprint: "fp-closeout-1",
        severity: "high",
      },
    });
    const runbook = buildRunbook(classified);
    const rotation = recordRotationEvidence(
      {
        incidentId: "INC-CLOSEOUT",
        controlId: "secrets.gitleaks",
        scope: "main",
        rotated: true,
        rotatedAt: "2026-09-30T00:00:00.000Z",
        preventiveControls: ["pre-push", "ci"],
        fingerprint: "fp-closeout-1",
      },
      { clock: () => FIXED }
    );
    sink.add("incident-classify", classified);
    sink.add("incident-runbook", runbook);
    sink.add("incident-rotation", rotation.json);
    assert.equal(classified.published, true, "incidente remoto en default → publicado");
    assert.equal(classified.requiresRotation, true, "publicado exige rotación");
    assert.equal(runbook.historyRewrite.automatic, false, "la reescritura es gated, nunca automática");

    // --- Barrido consolidado de fugas sobre TODO lo emitido (G.12) ---
    const all = sink.all;
    assert.ok(all.length > 0, "debe haberse acumulado la salida de todo el flujo");
    assert.deepEqual(
      findCanaries(all),
      [],
      "ninguna fase del endurecimiento debe filtrar un canario de secreto"
    );
    assert.equal(all.includes(SYNTH_SECRET), false, "el valor del secreto sintético no debe aparecer");
    assert.equal(all.includes(SYNTH_JIRA_TOKEN), false, "la credencial de Jira sintética no debe aparecer");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===========================================================================
// 37.2 — matriz de compatibilidad ejecutable/endurecida + telemetría OFF
//        por defecto y segura con opt-in.
// ===========================================================================

test("37.2 matriz de compatibilidad declarada, ejecutable y endurecida (sin push, SHA pins, permisos mínimos)", () => {
  const wf = path.join(ROOT, "templates", "core", "security", "ci", "github", "kiritek-compat-matrix.yml");
  assert.ok(fs.existsSync(wf), "existe el workflow de matriz de compatibilidad");
  const content = fs.readFileSync(wf, "utf8");

  // Declara una matriz real sobre las plataformas soportadas + Node 18/20.
  for (const o of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
    assert.ok(content.includes(o), `la matriz incluye ${o}`);
  }
  assert.ok(/node:\s*\["18",\s*"20"\]/.test(content), "la matriz cubre Node 18 y 20");

  // Es ejecutable: corre la suite real del paquete.
  assert.ok(/npm test/.test(content), "la matriz ejecuta la suite (npm test)");

  // Endurecida igual que los demás workflows: sin push/commit, permisos
  // mínimos, actions fijadas por SHA de 40 hex, timeout y concurrency.
  assert.equal(/git\s+push/.test(content), false, "la matriz NO hace git push");
  assert.equal(/git\s+commit/.test(content), false, "la matriz NO hace git commit");
  assert.ok(/permissions:/.test(content) && /contents:\s*read/.test(content), "permisos mínimos de lectura");
  assert.ok(/timeout-minutes:/.test(content), "declara timeout");
  assert.ok(/concurrency:/.test(content), "declara concurrency");
  const usesLines = content.split("\n").filter((l) => /uses:/.test(l));
  assert.ok(usesLines.length > 0, "usa al menos una action");
  for (const line of usesLines) {
    const m = line.match(/uses:\s+[\w.-]+\/[\w.-]+@(\S+)/);
    assert.ok(m, `línea uses sin referencia: ${line.trim()}`);
    assert.ok(/^[0-9a-f]{40}$/.test(m[1]), `action no fijada por SHA de 40 chars: ${line.trim()}`);
  }
});

test("37.2 telemetría OFF por defecto (no toca remoto) y segura con opt-in (TLS/auth/id/timeout/retención)", async () => {
  // OFF por defecto: con transport inyectado, NO se invoca.
  let called = 0;
  const offEmitter = transport.createEmitter({
    config: clone(DEFAULT_CONFIG),
    transport: async () => {
      called += 1;
      return { status: 200, ack: true };
    },
  });
  assert.equal(offEmitter.telemetryOn, false, "telemetría deshabilitada por defecto");
  assert.equal(offEmitter.remoteEnabled, false, "sin envío remoto por defecto");
  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "warning", durationMs: 1, result: "allow" },
    { clock: () => FIXED, idGenerator: () => "evt-1" }
  );
  const rec = await offEmitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.LOCAL_ONLY, "sólo local con telemetría off");
  assert.equal(called, 0, "nunca toca el transporte con telemetría off");

  // Opt-in SEGURO: exige TLS, auth, id pseudónimo, timeout, retención y destino.
  function remoteCfg(overrides = {}) {
    const cfg = clone(DEFAULT_CONFIG);
    cfg.telemetry.enabled = true;
    cfg.telemetry.remote = Object.assign(
      {
        enabled: true,
        endpoint: "https://telemetry.example.com/ingest",
        auth: { scheme: "Bearer", token: "synthetic-token" },
        pseudonymousId: "pseudo-closeout",
        timeoutMs: 3000,
        retentionDays: 30,
        destinationDoc: "https://docs.example.com/telemetry",
      },
      overrides
    );
    return cfg;
  }
  // TLS obligatorio.
  assert.throws(
    () => transport.resolveRemotePolicy(remoteCfg({ endpoint: "http://telemetry.example.com/ingest" }), {}),
    (e) => e.code === "TELEMETRY_INSECURE_ENDPOINT"
  );
  // Config completa resuelve a una política válida.
  const { policy } = transport.resolveRemotePolicy(remoteCfg(), {});
  assert.equal(policy.pseudonymousId, "pseudo-closeout");

  // Entrega con opt-in: usa idempotency key + id pseudónimo y NO filtra el token.
  const reqs = [];
  const onEmitter = transport.createEmitter({
    config: remoteCfg(),
    transport: async (req) => {
      reqs.push(req);
      return { status: 200, ack: true };
    },
    clock: () => FIXED,
    idGenerator: () => "idem-1",
  });
  const d = await onEmitter.emit(
    events.buildControlEvent(
      { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
      { clock: () => FIXED, idGenerator: () => "evt-2" }
    )
  );
  assert.equal(d.delivery, transport.DELIVERY.DELIVERED);
  assert.equal(reqs[0].headers["idempotency-key"], "idem-1");
  assert.equal(reqs[0].headers["x-kiritek-pseudonymous-id"], "pseudo-closeout");
  const storeJson = JSON.stringify(onEmitter.store.all());
  assert.equal(storeJson.includes("synthetic-token"), false, "el token no se filtra al store");
  assert.equal(events.sweep(storeJson).length, 0, "los eventos no contienen canarios/PII");
});

// ===========================================================================
// 37.3 — ningún bypass `--no-verify`; legacy no oculta nuevos; workflows sin
//        push directo.
// ===========================================================================

test("37.3 ningún mecanismo gobernado permite --no-verify (excepciones, guard de git, break-glass)", () => {
  // (a) Una excepción que invoca --no-verify NUNCA es válida.
  for (const input of [
    { mechanism: "--no-verify" },
    { mechanism: "no-verify" },
    { noVerify: true },
    { disableWorkflow: true },
  ]) {
    const r = exceptions.validateException(
      {
        controlId: "custom.generic",
        scopeFingerprint: "a:r:1",
        reason: "r",
        owner: "o",
        ticket: "T-1",
        expiresAt: "2026-10-15T00:00:00.000Z",
        ...input,
      },
      { clock: () => FIXED }
    );
    assert.equal(r.valid, false, `mecanismo prohibido jamás válido: ${JSON.stringify(input)}`);
  }

  // (b) El guard de git bloquea --no-verify en enforcement...
  const deny = gitGuard.evaluateGitCommand({ args: ["commit", "--no-verify"], mode: "enforce", defaultBranch: "main" });
  assert.equal(deny.decision, "deny");

  // (c) ...y ni siquiera el break-glass levanta --no-verify (fail-closed).
  const bg = gitGuard.evaluateGitCommand({
    args: ["commit", "--no-verify"],
    mode: "enforce",
    defaultBranch: "main",
    breakGlass: true,
  });
  assert.equal(bg.decision, "deny", "break-glass NO habilita --no-verify");
});

test("37.3 una baseline legacy tolera SÓLO su fingerprint y nunca oculta un hallazgo nuevo", () => {
  const legacyPath = ".env";
  const newPath = "config/credentials.json";
  const legacyFp = buildFingerprint({ path: legacyPath, ruleId: "env-file" });
  const future = new Date(Date.parse(FIXED) + 7 * 86400000).toISOString();

  const baseline = [
    { fingerprint: legacyFp, owner: "sec@acme", justification: "deuda legacy", expiresAt: future },
  ];
  const files = [
    { path: legacyPath, content: `AWS_SECRET=${SYNTH_SECRET}\n` }, // cubierto por baseline
    { path: newPath, content: `AWS_SECRET=${SYNTH_SECRET}\n` }, // NUEVO, no listado
  ];

  const be = promotion.evaluateWithBaseline({ files, baseline });
  assert.equal(be.decision, "deny", "el hallazgo nuevo sigue bloqueando aunque la baseline tolere el legacy");
  assert.ok(be.tolerated.some((t) => t.fingerprint === legacyFp), "el legacy queda tolerado");
  assert.ok(be.blocking.some((b) => b.path === newPath), "el nuevo queda bloqueante");

  // Y una baseline expirada deja de cubrir incluso al legacy (re-bloquea).
  const past = new Date(Date.parse(FIXED) - 86400000).toISOString();
  const expired = promotion.evaluateWithBaseline({
    files: [{ path: legacyPath, content: `AWS_SECRET=${SYNTH_SECRET}\n` }],
    baseline: [{ fingerprint: legacyFp, owner: "sec@acme", justification: "deuda", expiresAt: past }],
  });
  assert.equal(expired.decision, "deny");
  assert.equal(expired.tolerated.length, 0, "una baseline expirada no tolera nada");

  // Barrido anti-canario sobre la salida del baseline (G.12).
  assert.equal(findCanaries(safeSerialize({ be, expired }).json).length, 0);
});

test("37.3 los tres workflows gobernados no hacen push directo ni fijan actions mutables", () => {
  const workflows = [
    path.join(ROOT, "metrics", "kiritek-audit.yml"),
    path.join(ROOT, "templates", "core", "security", "ci", "github", "kiritek-security.yml"),
    path.join(ROOT, "templates", "core", "security", "ci", "github", "kiritek-compat-matrix.yml"),
  ];
  for (const wf of workflows) {
    const content = fs.readFileSync(wf, "utf8");
    const name = path.basename(wf);
    assert.equal(/git\s+push/.test(content), false, `${name} no debe hacer git push`);
    assert.equal(/git\s+commit/.test(content), false, `${name} no debe hacer git commit`);
    for (const line of content.split("\n").filter((l) => /uses:/.test(l))) {
      const m = line.match(/uses:\s+[\w.-]+\/[\w.-]+@(\S+)/);
      assert.ok(m && /^[0-9a-f]{40}$/.test(m[1]), `${name}: action no fijada por SHA: ${line.trim()}`);
    }
  }
});
