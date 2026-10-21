"use strict";

/** Casos de conformidad R27 de `search.input-rate` (T16.1). */

const ALL = ["cadence", "cancellation", "dedupe", "minimum", "propagation", "stale-order"];
const contract = (adapter, over = {}) => ({
  schemaVersion: 1,
  control: "search.input-rate",
  triggers: "remote",
  cancellation: "supported",
  equivalence: "trim-lowercase",
  harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  ...over,
});
const withContract = (c) => ({ files: { "apps/x/search.contract.json": JSON.stringify(c) }, parameters: { behaviorContract: "apps/x/search.contract.json" } });

module.exports = {
  control: "search.input-rate",
  profiles: ["search"],
  cases: [
    { id: "debounce-correcto", kind: "positive", ...withContract(contract("good-debounce")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "throttle-correcto", kind: "positive", ...withContract(contract("good-throttle")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "salida-ruidosa-aislada", kind: "positive", ...withContract(contract("noisy")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "ingenua-todas-las-reglas", kind: "negative", ...withContract(contract("naive")), expect: { decision: "warn", rules: ALL, eligible: true } },
    { id: "sin-cancelacion-exige-supersesion", kind: "negative", ...withContract(contract("naive", { cancellation: "unsupported" })), expect: { decision: "warn", rules: ALL.filter((r) => r !== "cancellation"), eligible: true } },
    {
      id: "excepcion-de-minimo-probada",
      kind: "edge",
      ...withContract(contract("naive", { minCharsException: { reason: "Búsqueda por código de 1-2 caracteres", testedBy: "apps/x/search.test.ts" } })),
      expect: { decision: "warn", rules: ALL.filter((r) => r !== "minimum"), eligible: true },
    },
    { id: "sin-contrato-heuristica", kind: "edge", files: { "apps/x/search.ts": "input.addEventListener('input', (e) => fetch('/api/search?q=' + e.target.value));\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "busqueda-local-pide-na", kind: "edge", ...withContract(contract("good-debounce", { triggers: "local" })), expect: { decision: "warn", eligible: false, reason: /LOCAL_SEARCH_REQUIRES_GOVERNED_NA/ } },
    { id: "flaky-no-bloquea", kind: "edge", ...withContract(contract("flaky")), expect: { eligible: false, deterministic: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contract("throws")), expect: { eligible: false } },
    { id: "contrato-invalido", kind: "edge", files: { "apps/x/search.contract.json": JSON.stringify({ schemaVersion: 1, control: "search.input-rate" }) }, parameters: { behaviorContract: "apps/x/search.contract.json" }, expect: { decision: "error", eligible: false } },
  ],
};
