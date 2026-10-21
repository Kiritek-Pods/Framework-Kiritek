"use strict";

// T30: `nav.broken-routes` — "no encontrado" con salida, URLs mal formadas y destino tras el login.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runControl } = require("../helpers/behavior-controls.js");
const { concrete } = require("../../../src/engineering/guardrails/controls/nav-broken-routes/scenarios.js");

const SPEC = { slug: "nav-broken-routes", factory: "createRouterUnderTest", contractKind: "routes-contract", behaviorKind: "routes-behavior", fixtures: "routes", param: "routesContract", harnessParams: (f) => ({ routes: f.routes, deepLinks: f.deepLinks }) };
const FACTS = { routes: [{ path: "/", auth: false }, { path: "/orders/:id", auth: true }, { path: "/products/:slug", auth: false }], deepLinks: "required", hasHarness: true, harnessKind: "node-adapter" };

test("T30.2 la implementación correcta pasa; la traza no lleva URLs", async () => {
  const { trace, result } = await runControl(SPEC, "good", FACTS);
  assert.equal(result.decision, "allow", JSON.stringify(result));
  assert.deepEqual(trace.scenarios.map((s) => s.id), ["known", "unknown", "malformed", "deep-auth"]);
  assert.ok(!JSON.stringify(trace).includes("/orders") && !JSON.stringify(trace).includes("kitems"));
  assert.equal(concrete("/orders/:id/items/:itemId"), "/orders/k123/items/k123");
});

const MATRIX = {
  "blank-not-found": ["exit-link", "not-found-page"],
  "no-exit-link": ["exit-link"],
  "crash-on-malformed": ["malformed-url"],
  "no-auth-redirect": ["auth-redirect", "keep-query", "return-after-login"],
  "forget-return": ["keep-query", "return-after-login"],
  "drop-query": ["keep-query"],
};
for (const [adapter, rules] of Object.entries(MATRIX)) {
  test(`T30.3 ${adapter}: deny determinista con reglas ${rules.join(", ")}`, async () => {
    const r = await runControl(SPEC, adapter, FACTS);
    assert.equal(r.result.decision, "deny");
    assert.deepEqual(r.rules, rules);
  });
}

test("T30.2 sin enlaces profundos declarados o sin rutas protegidas no se prueba el login", async () => {
  const r = await runControl(SPEC, "forget-return", { ...FACTS, deepLinks: "not-applicable" });
  assert.ok(!r.trace.scenarios.some((s) => s.id === "deep-auth"));
  assert.equal(r.result.decision, "allow");
});
