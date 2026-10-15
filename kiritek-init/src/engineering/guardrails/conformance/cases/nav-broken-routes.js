"use strict";

/** Casos de conformidad R27 de `nav.broken-routes` (T30.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "nav.broken-routes",
    routes: [
      { path: "/", auth: false },
      { path: "/products/:slug", auth: false },
      { path: "/orders/:id", auth: true },
    ],
    deepLinks: "required",
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/routes.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { routesContract: "apps/x/routes.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "nav.broken-routes",
  profiles: ["routed-app"],
  cases: [
    { id: "rutas-correctas", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-enlaces-profundos", kind: "positive", ...withContract(contractDoc("forget-return", (d) => (d.deepLinks = "not-applicable"))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("pantalla-en-blanco", "blank-not-found", ["exit-link", "not-found-page"]),
    negative("sin-salida", "no-exit-link", ["exit-link"]),
    negative("url-rota-rompe-la-app", "crash-on-malformed", ["malformed-url"]),
    negative("error-sin-sesion", "no-auth-redirect", ["auth-redirect", "keep-query", "return-after-login"]),
    negative("olvida-el-destino", "forget-return", ["keep-query", "return-after-login"]),
    negative("pierde-parametros", "drop-query", ["keep-query"]),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/router.tsx": "export const r = createBrowserRouter(routes);\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
