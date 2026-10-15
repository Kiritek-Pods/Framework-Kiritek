"use strict";

// T15A: telemetría engineering minimizada y opt-in.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = os.devNull;

const T = require("../../../src/engineering/guardrails/telemetry/index.js");
const { sweepArtifacts } = require("../../../src/engineering/guardrails/privacy/validate-output.js");
const { CONFIG, write, makeRepo, runCli } = require("../helpers/surfaces-repo.js");
const P = require("../helpers/pipeline.js");

const NOW = "2026-10-05T12:00:00.000Z";
const FIX = path.join(__dirname, "..", "fixtures", "announcement");
const CANARIES = ["KCANARY-mail-3b4c", "KCANARY-user-5d6e", "KCANARY-track-7f80"];
const clean = (d) => fs.rmSync(d, { recursive: true, force: true });

// --- T15A.1 -----------------------------------------------------------------------------

test("T15A.1 eventos locales: IDs, versiones, estado, duración, cache y categoría de error; nada de producto", async () => {
  const { report } = await P.run();
  const events = T.runEvents(report, { at: NOW, platformKey: "test-platform" });
  assert.ok(events.length >= 1);
  const e = events.find((x) => x.controlId === P.CONTROL);
  assert.deepEqual(Object.keys(e).sort(), ["at", "blocking", "cache", "catalogDigest", "catalogVersion", "controlId", "controlVersion", "decision", "durationMs", "errorCategory", "findings", "id", "level", "moment", "packId", "platformKey", "schemaVersion", "state", "suppressed", "type", "unitRef"].sort());
  assert.match(e.unitRef, /^u-[0-9a-f]{16}$/);
  const text = JSON.stringify(events);
  for (const leak of ["acme/web", "apps/web", "remediation", "ruleId", "fp-obs", "reason"]) assert.ok(!text.includes(leak), leak);
  const again = T.runEvents(report, { at: NOW, platformKey: "test-platform" });
  assert.deepEqual(again.map((x) => x.id), events.map((x) => x.id), "id determinista (idempotencia)");
  const status = T.runEvents(report, { at: NOW, categories: ["control-status"] })[0];
  assert.equal(status.durationMs, undefined);
  assert.equal(status.cache, undefined);
  assert.equal(status.errorCategory, undefined);
  assert.throws(() => T.sanitizeEvent({ type: "control-run", controlId: "x.y", unitRef: "KCANARY-user-5d6e" }, { canaries: CANARIES }), { code: "REDACTION_FAILED" });
});

test("T15A.1 feedback de calidad y alertas agregadas sin payloads", () => {
  const fb = (i, verdict) => T.feedbackEvent({ controlId: "search.input-rate", controlVersion: "1.0.0", ruleId: "search.input-rate/cadence", fingerprint: `fp-secreto-${i}`, verdict, remediationMinutes: 30, at: NOW });
  const events = [fb(1, "confirmed"), fb(2, "false-positive"), fb(3, "false-positive"), { type: "control-run", controlId: "search.input-rate", state: "timeout", decision: "error", errorCategory: "timeout" }, { type: "control-run", controlId: "search.input-rate", state: "evaluated", decision: "warn" }];
  assert.ok(!JSON.stringify(events).includes("fp-secreto"), "fingerprint pseudonimizado");
  const q = T.qualityByControl(events)["search.input-rate"];
  assert.deepEqual([q.runs, q.confirmed, q.falsePositives, q.timeouts], [2, 1, 2, 1]);
  assert.ok(Math.abs(q.falsePositiveRate - 2 / 3) < 1e-9);
  const alerts = T.aggregateAlerts(events);
  assert.deepEqual(alerts.map((a) => a.category), ["error-rate", "false-positive-rate"]);
  assert.ok(alerts.every((a) => Object.keys(a).every((k) => ["category", "controlId", "value", "runs", "judged"].includes(k))));
  assert.throws(() => T.feedbackEvent({ controlId: "x.y", verdict: "maybe", at: NOW }), { code: "TELEMETRY_INVALID" });
});

// --- T15A.2 / T15A.3 -----------------------------------------------------------------------

function storeWith(n, at = NOW) {
  const store = T.createMemoryStore();
  store.append(Array.from({ length: n }, (_, i) => ({ id: `evt-${i}`, type: "control-run", at, controlId: "x.y" })));
  return store;
}
const ENABLED = { enabled: true, endpoint: "https://telemetry.example.invalid/v1", retentionDays: 14 };
const ENV = { [T.TOKEN_ENV]: "tok-123" };

test("T15A.2 remoto sólo opt-in: https, token por entorno; nunca http ni token ausente", () => {
  assert.equal(T.resolveRemote({ enabled: false, endpoint: ENABLED.endpoint }, ENV), null);
  assert.equal(T.resolveRemote({ enabled: true, endpoint: null }, ENV), null);
  assert.throws(() => T.resolveRemote({ ...ENABLED, endpoint: "http://telemetry.example.invalid" }, ENV), { code: "TELEMETRY_INSECURE_ENDPOINT" });
  assert.throws(() => T.resolveRemote(ENABLED, {}), { code: "TELEMETRY_MISSING_CREDENTIAL" });
  assert.equal(T.resolveRemote(ENABLED, ENV).token, "tok-123");
});

test("T15A.2/T15A.3 entrega: ack obligatorio, idempotencia, anti-replay, timeout/fallo ⇒ pending conservado", async () => {
  const remote = T.resolveRemote(ENABLED, ENV);
  const sent = [];
  const ok = async (req) => {
    sent.push(req);
    return { status: 202, ack: req.headers["idempotency-key"] };
  };
  const store = storeWith(2);
  assert.deepEqual(await T.flush(store, remote, ok, { nowIso: NOW }), { delivered: 2, pending: 0, duplicates: 0, expired: 0, remote: true });
  assert.equal(sent[0].headers.authorization, "Bearer tok-123");
  assert.equal(sent[0].headers["idempotency-key"], "evt-0");
  assert.match(sent[0].headers["x-kiritek-installation"], /^inst-/);
  assert.equal(sent[0].timeoutMs, 5000);
  assert.deepEqual(await T.flush(store, remote, ok, { nowIso: NOW }), { delivered: 0, pending: 0, duplicates: 2, expired: 0, remote: true }, "replay ⇒ no se reenvía");

  for (const bad of [async () => ({ status: 500 }), async () => ({ status: 200 }), async (r) => ({ status: 200, ack: `${r.headers["idempotency-key"]}-x` }), async () => Promise.reject(Object.assign(new Error("t"), { code: "TELEMETRY_TIMEOUT" }))]) {
    const s = storeWith(1);
    const res = await T.flush(s, remote, bad, { nowIso: NOW });
    assert.deepEqual([res.delivered, res.pending], [0, 1]);
    assert.equal(s.isDelivered("evt-0"), false, "sin ack no hay delivered");
    assert.equal(s.all().length, 1, "el evento local se conserva");
  }
  const old = storeWith(1, "2026-08-01T00:00:00.000Z");
  assert.equal((await T.flush(old, remote, ok, { nowIso: NOW })).expired, 1, "fuera de retención no se reenvía");
  assert.deepEqual(await T.flush(storeWith(3), null, ok, { nowIso: NOW }), { delivered: 0, pending: 3, duplicates: 0, expired: 0, remote: false });
});

test("T15A.2 retención local: recordLocal poda lo vencido y no duplica ids", () => {
  const store = storeWith(1, "2026-08-01T00:00:00.000Z");
  assert.deepEqual(T.recordLocal(store, [{ id: "n1", at: NOW }], { telemetry: { enabled: false }, nowIso: NOW }), { recorded: 0, pruned: 0, enabled: false });
  assert.deepEqual(T.recordLocal(store, [{ id: "n1", at: NOW }, { id: "n1", at: NOW }].slice(0, 1), { telemetry: ENABLED, nowIso: NOW }), { recorded: 1, pruned: 1, enabled: true });
  assert.equal(T.recordLocal(store, [{ id: "n1", at: NOW }], { telemetry: ENABLED, nowIso: NOW }).recorded, 0);
});

// --- T15A.4 (CLI) -----------------------------------------------------------------------------

test("T15A.4 off por defecto; activa ⇒ eventos locales sin canarios; flush con transporte inyectado", async () => {
  const { repo, base, head } = makeRepo();
  try {
    write(repo, "apps/web/announce.adapter.js", fs.readFileSync(path.join(FIX, "leaky.adapter.js.fixture")));
    const scan = () => runCli(["scan", "--moment=pr", `--base=${base}`, `--revision=${head}`, "--offline"], repo);
    assert.equal((await scan()).code, 0);
    const file = path.join(repo, ".kiritek/telemetry/engineering/events.jsonl");
    assert.equal(fs.existsSync(file), false, "telemetría off por defecto");

    const doc = JSON.parse(fs.readFileSync(path.join(repo, CONFIG), "utf8"));
    doc.telemetry = { enabled: true, endpoint: "https://telemetry.example.invalid/v1" };
    write(repo, CONFIG, JSON.stringify(doc, null, 2));
    assert.equal((await scan()).code, 0);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.trim().split("\n").length >= 3);
    assert.deepEqual(sweepArtifacts({ events: text }, { canaries: CANARIES }), []);
    for (const leak of ["acme/", "apps/", "launch.json"]) assert.ok(!text.includes(leak), leak);

    const fb = await runCli(["feedback", "--control=web.module-announcement", "--rule=web.module-announcement/close", "--fingerprint=wma:close:close", "--verdict=false-positive", "--remediation-minutes=15"], repo);
    assert.equal(fb.code, 0, fb.err);
    const st = await runCli(["telemetry", "status"], repo, { env: { [T.TOKEN_ENV]: "tok" } });
    assert.equal(st.json.enabled, true);
    assert.equal(st.json.remote, true);

    const noToken = await runCli(["telemetry", "flush"], repo);
    assert.equal(noToken.json.error, "TELEMETRY_MISSING_CREDENTIAL");
    let calls = 0;
    const send = async (req) => {
      calls += 1;
      assert.ok(!req.body.includes("acme/") && !req.body.includes("KCANARY"));
      return { status: 200, ack: req.headers["idempotency-key"] };
    };
    const flushed = await runCli(["telemetry", "flush"], repo, { env: { [T.TOKEN_ENV]: "tok" }, send });
    assert.equal(flushed.json.delivered, calls);
    assert.equal(flushed.json.pending, 0);
    const again = await runCli(["telemetry", "flush"], repo, { env: { [T.TOKEN_ENV]: "tok" }, send });
    assert.equal(again.json.delivered, 0);
    assert.equal(again.json.duplicates, calls);
  } finally {
    clean(repo);
  }
});
