"use strict";

/** Casos de conformidad R27 de `analytics.events` (T25.4). */

function planDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "analytics.events",
    events: [
      { name: "checkout.completed", properties: [{ name: "amount", type: "number", required: true }, { name: "currency", type: "string", required: true, enum: ["CLP", "USD"] }, { name: "coupon", type: "boolean", required: false }] },
      { name: "signup.started", properties: [{ name: "source", type: "string", required: false }] },
    ],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withPlan = (doc) => ({ files: { "apps/x/tracking.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { trackingPlan: "apps/x/tracking.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withPlan(planDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "analytics.events",
  profiles: ["analytics"],
  cases: [
    { id: "tracking-correcto", kind: "positive", ...withPlan(planDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "eventos-sin-propiedades", kind: "positive", ...withPlan(planDoc("good", (d) => (d.events[0].properties = []))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("falta-obligatoria", "skip-required", ["schema"]),
    negative("tipos-incorrectos", "wrong-types", ["schema"]),
    negative("propiedades-fuera-del-plan", "extra-props", ["unplanned-properties"]),
    negative("fuga-de-email", "leak-pii", ["pii-leak", "unplanned-properties"]),
    negative("evento-doble", "double-emit", ["duplicate-delivery", "emitted-once"]),
    negative("analytics-rompe-la-app", "throw-on-failure", ["failure-isolation"]),
    negative("duplica-al-reintentar", "duplicate-on-retry", ["duplicate-delivery"]),
    { id: "plan-con-dato-personal", kind: "negative", ...withPlan(planDoc("good", (d) => d.events[1].properties.push({ name: "user_email", type: "string", required: false }))), expect: { decision: "warn", rules: ["pii-property"], eligible: true } },
    { id: "plan-invalido", kind: "negative", ...withPlan("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-plan-inferencia", kind: "edge", files: { "apps/x/src/checkout.ts": "analytics.track('checkout.completed', { amount });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withPlan(planDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withPlan(planDoc("throws")), expect: { eligible: false } },
  ],
};
