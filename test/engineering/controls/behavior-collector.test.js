"use strict";

// T18–T21: collector común — dos corridas (inestable ⇒ conflict, nunca deny),
// trace-command, rutas fuera del repo, momentos rápidos y privacidad.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { FIXTURES } = require("../helpers/behavior-controls.js");
const statesCollector = require("../../../src/engineering/guardrails/controls/ui-data-states/collector.js");
const flagsCollector = require("../../../src/engineering/guardrails/controls/flags-lifecycle/collector.js");
const { runSuite } = require("../../../src/engineering/guardrails/controls/ui-data-states/harness.js");

const CONTRACT = { schemaVersion: 1, control: "ui.data-states", screens: [{ id: "orders", timeoutMs: 5000, emptyState: "required", retry: "required" }] };

function repoWith(files) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-bc-")));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
  return repo;
}
const ctx = (repo, parameters, moment = "pr") => ({ repoRoot: repo, unit: { id: "acme/x", root: "apps/x" }, parameters, moment, budgetMs: 120000, scope: { paths: [] } });
const fixture = (dir, name) => fs.readFileSync(path.join(FIXTURES, dir, `${name}.adapter.js.fixture`), "utf8");

test("T18–T21 collector: corre el harness dos veces; resultados iguales ⇒ complete", async () => {
  const repo = repoWith({ "apps/x/states.json": JSON.stringify({ ...CONTRACT, harness: { kind: "node-adapter", adapter: "apps/x/good.adapter.js" } }), "apps/x/good.adapter.js": fixture("data-states", "good") });
  try {
    const out = await statesCollector.collect(ctx(repo, { statesContract: "apps/x/states.json" }));
    const behavior = out.filter((o) => o.kind === "states-behavior");
    assert.equal(behavior.length, 7);
    assert.ok(behavior.every((o) => o.status === "complete" && o.confidence === "deterministic"));
    assert.equal(out[0].locationRef, "apps/x/states.json");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T18–T21 collector: un adapter que cambia entre corridas queda en conflict (FLAKY_SCENARIO)", async () => {
  // Alterna por proceso: cada corrida del harness ve un número de ítems distinto.
  const flaky = fixture("data-states", "good").replace(
    'exports.createScreenUnderTest = ',
    'const fs = require("node:fs");\nconst COUNTER = require("node:path").join(__dirname, ".runs");\nconst RUN = (fs.existsSync(COUNTER) ? Number(fs.readFileSync(COUNTER, "utf8")) : 0) + 1;\nfs.writeFileSync(COUNTER, String(RUN));\nexports.createScreenUnderTest = '
  ).replace("items: r.items.length,", "items: r.items.length + (RUN % 2),");
  const repo = repoWith({ "apps/x/states.json": JSON.stringify({ ...CONTRACT, harness: { kind: "node-adapter", adapter: "apps/x/flaky.adapter.js" } }), "apps/x/flaky.adapter.js": flaky });
  try {
    const out = await statesCollector.collect(ctx(repo, { statesContract: "apps/x/states.json" }));
    const conflict = out.filter((o) => o.status === "conflict");
    assert.ok(conflict.length >= 1, JSON.stringify(out.map((o) => o.status)));
    assert.ok(conflict.every((o) => o.limitations[0].code === "FLAKY_SCENARIO"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T18–T21 collector: trace-command usa la traza estándar del equipo; traza inválida ⇒ unavailable", async () => {
  const trace = await runSuite(require(path.join(__dirname, "..", "..", "..", "src", "engineering", "guardrails", "conformance", "reference", "ui-data-states", "good.adapter.js")).createScreenUnderTest, { screens: CONTRACT.screens });
  const emit = (body) => `require("node:fs").mkdirSync("out", { recursive: true }); require("node:fs").writeFileSync("out/trace.json", ${JSON.stringify(body)});\n`;
  const harness = { kind: "trace-command", command: "node", args: ["emit.js"], traceFile: "apps/x/out/trace.json" };
  for (const [body, want] of [[JSON.stringify(trace), "complete"], ['{"schemaVersion":1,"harness":{"name":"x","version":"1.0.0"},"scenarios":[{"id":"content@orders","status":"ok","steps":[{"state":"content","requests":1,"query":"secreto"}]}]}', "unavailable"]]) {
    const repo = repoWith({ "apps/x/states.json": JSON.stringify({ ...CONTRACT, harness }), "apps/x/emit.js": emit(body) });
    try {
      const out = await statesCollector.collect(ctx(repo, { statesContract: "apps/x/states.json" }));
      assert.equal(out[1].status, want, JSON.stringify(out[1]));
      if (want === "unavailable") assert.equal(out[1].facts.failure, "TRACE_SCHEMA");
      assert.ok(!JSON.stringify(out).includes("secreto"));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("T18–T21 collector: contrato fuera del repo, momentos rápidos y sin contrato", async () => {
  const repo = repoWith({ "apps/x/states.json": JSON.stringify({ ...CONTRACT, harness: { kind: "node-adapter", adapter: "apps/x/good.adapter.js" } }), "apps/x/good.adapter.js": fixture("data-states", "good"), "apps/x/src/a.ts": "fetch('/api');\n" });
  try {
    const outside = await statesCollector.collect(ctx(repo, { statesContract: "../etc/passwd" }));
    assert.deepEqual(outside[0].facts.errorCodes, ["CONTRACT_PATH_OUTSIDE_REPO"]);
    const fast = await statesCollector.collect(ctx(repo, { statesContract: "apps/x/states.json" }, "agent"));
    assert.equal(fast.length, 1, "en agent sólo se valida el contrato");
    const none = await statesCollector.collect(ctx(repo, {}));
    assert.equal(none[1].evidenceClass, "heuristic");
    assert.deepEqual(none[1].facts.signals.map((s) => s.path), ["apps/x/src/a.ts"]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("T21 collector: un registro sin `client` no corre harness aunque lo declare", async () => {
  const reg = { schemaVersion: 1, control: "flags.lifecycle", flags: [{ key: "a", owner: "t", kind: "ops", createdAt: "2026-01-01T00:00:00Z", defaultValue: false }], harness: { kind: "node-adapter", adapter: "apps/x/nope.js" } };
  const repo = repoWith({ "apps/x/flags.json": JSON.stringify(reg) });
  try {
    const out = await flagsCollector.collect(ctx(repo, { flagRegistry: "apps/x/flags.json" }));
    assert.equal(out.length, 1);
    assert.equal(out[0].facts.valid, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
