"use strict";

/** Casos de conformidad R27 de `i18n.formatting` (T27.4). */

function contractDoc(adapter, mutate = () => {}) {
  const doc = { schemaVersion: 1, control: "i18n.formatting", locales: ["en-US", "es-CL", "ja-JP"], defaultLocale: "en-US", currency: "CLP", formats: ["date", "number", "currency", "timezone", "messages"], harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` } };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/i18n.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { i18nContract: "apps/x/i18n.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withContract(contractDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "i18n.formatting",
  profiles: ["localized"],
  cases: [
    { id: "formatos-correctos", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "solo-mensajes", kind: "positive", ...withContract(contractDoc("to-fixed", (d) => (d.formats = ["messages"]))), expect: { decision: "allow", rules: [], eligible: false } },
    negative("todo-en-ingles", "fixed-locale", ["number-format"]),
    negative("fecha-armada-a-mano", "manual-date", ["date-format", "time-zone"]),
    negative("numeros-con-tofixed", "to-fixed", ["number-format"]),
    negative("montos-sin-moneda", "no-currency", ["currency-format"]),
    negative("fechas-en-utc", "ignore-time-zone", ["time-zone"]),
    negative("sin-idioma-de-respaldo", "no-fallback", ["locale-fallback", "missing-message"]),
    negative("clave-sin-traducir", "raw-missing", ["missing-message"]),
    { id: "idioma-por-defecto-ausente", kind: "negative", ...withContract(contractDoc("good", (d) => (d.defaultLocale = "pt-BR"))), expect: { decision: "warn", rules: ["contract-default-locale"], eligible: true } },
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/price.ts": "export const price = (n) => '$' + n.toFixed(2);\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
