"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const events = require("../../src/telemetry/events.js");
const transport = require("../../src/telemetry/transport.js");
const { DEFAULT_CONFIG, clone } = require("../../src/config/defaults.js");

// Reloj/id deterministas para pruebas reproducibles.
const fixedClock = () => "2024-01-01T00:00:00.000Z";
function seqIds(prefix) {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

// ----------------------------------------------------------------------------
// 34.1 — Eventos locales estructurados
// ----------------------------------------------------------------------------

test("buildControlEvent: emite evento estructurado con todas las dimensiones base", () => {
  const ev = events.buildControlEvent(
    {
      control: "gitleaks.staged",
      version: "8.18.4",
      mode: "enforce",
      durationMs: 120,
      scope: { files: 3, commits: 1 },
      result: "deny",
      errorCategory: "none",
      dimensions: { installed: true, coverage: 1, recentRun: true, findings: 2, enforcement: "enforce" },
    },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );

  assert.equal(ev.type, "control_run");
  assert.equal(ev.control, "gitleaks.staged");
  assert.equal(ev.version, "8.18.4");
  assert.equal(ev.mode, "enforce");
  assert.equal(ev.durationMs, 120);
  assert.deepEqual(ev.scope, { files: 3, commits: 1 });
  assert.equal(ev.result, "deny");
  assert.equal(ev.errorCategory, "none");
  assert.equal(ev.createdAt, "2024-01-01T00:00:00.000Z");
  assert.equal(ev.id, "evt-1");
});

test("buildControlEvent: rechaza result/errorCategory/mode inválidos", () => {
  const base = { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" };
  assert.throws(() => events.buildControlEvent({ ...base, result: "bogus" }));
  assert.throws(() => events.buildControlEvent({ ...base, errorCategory: "bogus" }));
  assert.throws(() => events.buildControlEvent({ ...base, mode: "bogus" }));
  assert.throws(() => events.buildControlEvent({ ...base, durationMs: -1 }));
});

test("normalizeAggregateScope: sólo contadores enteros, nunca rutas", () => {
  assert.throws(() => events.normalizeAggregateScope({ files: "a/b/c.js" }));
  assert.throws(() => events.normalizeAggregateScope({ files: 1.5 }));
  assert.deepEqual(events.normalizeAggregateScope({ files: 10, findings: 0 }), { files: 10, findings: 0 });
});

// ----------------------------------------------------------------------------
// 34.5 — Dimensiones SEPARADAS + presupuesto sin omitir controles
// ----------------------------------------------------------------------------

test("dimensiones de cumplimiento se presentan separadas (no un booleano)", () => {
  const ev = events.buildControlEvent(
    {
      control: "hooks.pre-commit",
      version: "1",
      mode: "warning",
      durationMs: 10,
      result: "allow",
      dimensions: { installed: true, coverage: 0.5, recentRun: false, findings: 0, enforcement: "warning" },
    },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  // Cinco dimensiones distintas, cada una explícita.
  assert.equal(ev.dimensions.installed, true);
  assert.equal(ev.dimensions.coverage, 0.5);
  assert.equal(ev.dimensions.recentRun, false);
  assert.equal(ev.dimensions.findings, 0);
  assert.equal(ev.dimensions.enforcement, "warning");
  // No existe un campo "compliant" colapsado; `collapsed` es explícitamente null.
  assert.equal(ev.dimensions.compliant, undefined);
  assert.equal(ev.dimensions.collapsed, null);
});

test("exceso de presupuesto se registra como degradación SIN omitir el control", () => {
  const ev = events.buildControlEvent(
    {
      control: "gitleaks.push",
      version: "8.18.4",
      mode: "enforce",
      durationMs: 9000,
      result: "allow",
      budget: { budgetMs: 5000 },
    },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  assert.equal(ev.budget.overBudget, true);
  assert.equal(ev.budget.degraded, true);
  assert.equal(ev.budget.controlSkipped, false); // el control NUNCA se omite.
  assert.ok(typeof ev.budget.guidance === "string" && ev.budget.guidance.length > 0);
});

// ----------------------------------------------------------------------------
// 34.2 — Exclusión de contenido/PII/rutas/URLs y barrido anti-canario
// ----------------------------------------------------------------------------

test("sanitizeEvent: elimina rutas absolutas y repo URL completa", () => {
  const ev = events.buildControlEvent(
    {
      control: "ci.scan",
      version: "1",
      mode: "warning",
      durationMs: 1,
      result: "warn",
      // Campos de texto libre con datos que NO deben filtrarse.
      scope: { files: 1 },
      dimensions: { installed: true, coverage: 1, recentRun: true, findings: 1, enforcement: "warning" },
    },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const json = JSON.stringify(ev);
  // No hay rutas absolutas ni repo URLs en un evento normal.
  assert.equal(events.sweep(json).length, 0);
});

test("sweep: detecta email, ruta absoluta, repo URL y canario de credencial", () => {
  assert.ok(events.sweep("contacto alice@example.com").includes("email"));
  assert.ok(events.sweep('path="/Users/alice/repo/x.js"').includes("abs-path-posix"));
  assert.ok(events.sweep("origin https://github.com/acme/secret-repo.git").includes("repo-url-https"));
  assert.ok(events.sweep("git@github.com:acme/secret-repo.git").includes("repo-url-ssh"));
  assert.ok(events.sweep("AKIA" + "ABCDEFGHIJKLMNOP").includes("aws-access-key"));
  assert.equal(events.sweep("control gitleaks.staged ok 120ms").length, 0);
});

test("stripSensitiveText: reemplaza ruta absoluta y repo URL por marcador", () => {
  const out = events.stripSensitiveText("falló en /Users/bob/proj/a.js origin https://gitlab.com/o/r.git");
  assert.ok(out.includes(events.STRIPPED));
  assert.equal(events.sweep(out).length, 0);
});

test("sanitizeEvent: bloquea (fail-closed) si sobrevive un valor sensible en una clave", () => {
  // Un canario embebido en el NOMBRE de una propiedad no lo saneа la redacción
  // por campo y debe hacer fallar el saneado del evento.
  const malformed = {
    schemaVersion: 1,
    type: "control_run",
    control: "x",
  };
  malformed["AKIA" + "ABCDEFGHIJKLMNOP"] = "y";
  assert.throws(
    () => events.sanitizeEvent(malformed),
    (err) => {
      assert.equal(err.code, "TELEMETRY_UNSAFE_EVENT");
      assert.ok(err.hits.includes("aws-access-key"));
      return true;
    }
  );
});

// ----------------------------------------------------------------------------
// 34.4 (alertas) — Alertas agregadas tool/Jira/bypass/excepciones
// ----------------------------------------------------------------------------

test("buildAlertEvent: alertas agregadas sólo con contadores y categoría", () => {
  for (const category of events.ALERT_CATEGORIES) {
    const ev = events.buildAlertEvent(
      { category, count: 3, window: "24h" },
      { clock: fixedClock, idGenerator: seqIds("al") }
    );
    assert.equal(ev.type, "alert");
    assert.equal(ev.category, category);
    assert.equal(ev.count, 3);
    assert.equal(ev.window, "24h");
    assert.equal(events.sweep(JSON.stringify(ev)).length, 0);
  }
  assert.throws(() => events.buildAlertEvent({ category: "nope", count: 1 }));
});

// ----------------------------------------------------------------------------
// 34.6 — Telemetría OFF por defecto
// ----------------------------------------------------------------------------

test("telemetría OFF por defecto: no intenta remoto aunque haya transport", async () => {
  let called = 0;
  const emitter = transport.createEmitter({
    config: clone(DEFAULT_CONFIG), // telemetry.enabled === false
    transport: async () => {
      called += 1;
      return { status: 200, ack: true };
    },
  });
  assert.equal(emitter.telemetryOn, false);
  assert.equal(emitter.remoteEnabled, false);

  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "warning", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec = await emitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.LOCAL_ONLY);
  assert.equal(called, 0, "no debe tocar el transporte con telemetría off");
  assert.equal(emitter.store.all().length, 1);
});

// ----------------------------------------------------------------------------
// 34.3 — Requisitos de envío remoto (opt-in, https, auth, id, timeout, retención, destino)
// ----------------------------------------------------------------------------

function remoteConfig(overrides = {}) {
  const cfg = clone(DEFAULT_CONFIG);
  cfg.telemetry.enabled = true;
  cfg.telemetry.remote = Object.assign(
    {
      enabled: true,
      endpoint: "https://telemetry.example.com/ingest",
      auth: { scheme: "Bearer", token: "synthetic-token" },
      pseudonymousId: "pseudo-abc",
      timeoutMs: 3000,
      retentionDays: 30,
      destinationDoc: "https://docs.example.com/telemetry",
    },
    overrides
  );
  return cfg;
}

test("remoto: rechaza endpoint http (TLS obligatorio)", () => {
  const cfg = remoteConfig({ endpoint: "http://telemetry.example.com/ingest" });
  assert.throws(
    () => transport.resolveRemotePolicy(cfg, {}),
    (e) => e.code === "TELEMETRY_INSECURE_ENDPOINT"
  );
});

test("remoto: exige auth, pseudonymousId, timeout, retención y destino", () => {
  assert.throws(
    () => transport.resolveRemotePolicy(remoteConfig({ auth: undefined }), {}),
    (e) => e.code === "TELEMETRY_NO_AUTH"
  );
  assert.throws(
    () => transport.resolveRemotePolicy(remoteConfig({ pseudonymousId: "" }), {}),
    (e) => e.code === "TELEMETRY_NO_PSEUDONYMOUS_ID"
  );
  assert.throws(
    () => transport.resolveRemotePolicy(remoteConfig({ timeoutMs: 0 }), {}),
    (e) => e.code === "TELEMETRY_NO_TIMEOUT"
  );
  assert.throws(
    () => transport.resolveRemotePolicy(remoteConfig({ retentionDays: 0 }), {}),
    (e) => e.code === "TELEMETRY_NO_RETENTION"
  );
  assert.throws(
    () => transport.resolveRemotePolicy(remoteConfig({ destinationDoc: "" }), {}),
    (e) => e.code === "TELEMETRY_NO_DESTINATION_DOC"
  );
});

test("remoto: credencial puede venir del entorno y falla ausente sin imprimirse", () => {
  const cfg = remoteConfig({ auth: { scheme: "Bearer" } });
  // Sin token en config ni env → falla.
  assert.throws(
    () => transport.resolveRemotePolicy(cfg, {}),
    (e) => e.code === "TELEMETRY_MISSING_CREDENTIAL"
  );
  // Con token en env → resuelve.
  const { policy } = transport.resolveRemotePolicy(cfg, { KIRITEK_TELEMETRY_TOKEN: "env-token" });
  assert.equal(policy.token, "env-token");
  assert.equal(policy.pseudonymousId, "pseudo-abc");
});

// ----------------------------------------------------------------------------
// 34.6 — Mock entrega/fallo/replay/timeout + deduplicación + preservación local
// ----------------------------------------------------------------------------

test("remoto: entrega confirmada marca delivered y usa idempotency key + id pseudónimo", async () => {
  const requests = [];
  const emitter = transport.createEmitter({
    config: remoteConfig(),
    transport: async (req) => {
      requests.push(req);
      return { status: 200, ack: true };
    },
    clock: fixedClock,
    idGenerator: seqIds("idem"),
  });
  assert.equal(emitter.remoteEnabled, true);

  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec = await emitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.DELIVERED);
  assert.equal(rec.confirmedAt, "2024-01-01T00:00:00.000Z");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["idempotency-key"], "idem-1");
  assert.equal(requests[0].headers["x-kiritek-pseudonymous-id"], "pseudo-abc");
  assert.equal(requests[0].timeoutMs, 3000);
  // El token no debe filtrarse al evento ni al store.
  assert.ok(!JSON.stringify(emitter.store.all().map((r) => r.event)).includes("synthetic-token"));
});

test("remoto: fallo de red conserva local como pending y NO marca delivered", async () => {
  const emitter = transport.createEmitter({
    config: remoteConfig(),
    transport: async () => {
      throw Object.assign(new Error("boom"), { code: "ECONNRESET" });
    },
    clock: fixedClock,
    idGenerator: seqIds("idem"),
  });
  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec = await emitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.PENDING);
  assert.equal(rec.confirmedAt, null);
  assert.equal(rec.lastError, "network");
  assert.equal(emitter.store.pending().length, 1);
});

test("remoto: sin ack explícito NO se marca delivered (queda pending)", async () => {
  const emitter = transport.createEmitter({
    config: remoteConfig(),
    transport: async () => ({ status: 200, ack: false }), // 2xx pero sin ack
    clock: fixedClock,
    idGenerator: seqIds("idem"),
  });
  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec = await emitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.PENDING);
});

test("remoto: timeout se clasifica como timeout y conserva local", async () => {
  const emitter = transport.createEmitter({
    config: remoteConfig(),
    transport: async () => {
      throw Object.assign(new Error("request timed out"), { name: "TimeoutError" });
    },
    clock: fixedClock,
    idGenerator: seqIds("idem"),
  });
  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec = await emitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.PENDING);
  assert.equal(rec.lastError, "timeout");
});

test("remoto: flushPending reintenta y anti-replay evita doble entrega", async () => {
  let attempt = 0;
  const emitter = transport.createEmitter({
    config: remoteConfig(),
    transport: async () => {
      attempt += 1;
      // Primer intento falla, segundo confirma.
      if (attempt === 1) throw Object.assign(new Error("down"), { code: "ECONNRESET" });
      return { status: 200, ack: true };
    },
    clock: fixedClock,
    idGenerator: seqIds("idem"),
  });
  const ev = events.buildControlEvent(
    { control: "c", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec = await emitter.emit(ev);
  assert.equal(rec.delivery, transport.DELIVERY.PENDING);

  // Reintento: ahora confirma.
  await emitter.flushPending();
  assert.equal(rec.delivery, transport.DELIVERY.DELIVERED);

  // Un nuevo flush no reenvía lo ya confirmado (anti-replay por key).
  const before = attempt;
  await emitter.flushPending();
  assert.equal(attempt, before, "no debe reenviar un evento ya confirmado");
});

test("deduplicación: una key ya entregada se marca duplicate y no reenvía", async () => {
  let sends = 0;
  const store = transport.createMemoryStore();
  const emitter = transport.createEmitter({
    config: remoteConfig(),
    store,
    transport: async () => {
      sends += 1;
      return { status: 200, ack: true };
    },
    clock: fixedClock,
    idGenerator: () => "fixed-key", // forzamos colisión de idempotency key
  });

  const ev1 = events.buildControlEvent(
    { control: "a", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec1 = await emitter.emit(ev1);
  assert.equal(rec1.delivery, transport.DELIVERY.DELIVERED);
  assert.equal(sends, 1);

  const ev2 = events.buildControlEvent(
    { control: "b", version: "1", mode: "enforce", durationMs: 1, result: "allow" },
    { clock: fixedClock, idGenerator: seqIds("evt") }
  );
  const rec2 = await emitter.emit(ev2);
  assert.equal(rec2.delivery, transport.DELIVERY.DUPLICATE);
  assert.equal(sends, 1, "la segunda con la misma key no debe reenviarse");
});

// ----------------------------------------------------------------------------
// G.12 / 26.6 — barrido anti-canario/PII sobre todos los eventos emitidos
// ----------------------------------------------------------------------------

test("ningún valor sensible aparece en los eventos del store tras una sesión", async () => {
  const emitter = transport.createEmitter({ config: clone(DEFAULT_CONFIG) });
  const ids = seqIds("evt");
  await emitter.emit(
    events.buildControlEvent(
      { control: "gitleaks.staged", version: "8.18.4", mode: "warning", durationMs: 42, result: "warn",
        scope: { files: 2, findings: 1 },
        dimensions: { installed: true, coverage: 1, recentRun: true, findings: 1, enforcement: "warning" } },
      { clock: fixedClock, idGenerator: ids }
    )
  );
  await emitter.emit(
    events.buildAlertEvent({ category: "bypasses", count: 1, window: "24h" }, { clock: fixedClock, idGenerator: ids })
  );
  const all = JSON.stringify(emitter.store.all());
  assert.equal(events.sweep(all).length, 0, "la sesión completa de telemetría no filtra canarios/PII");
});
