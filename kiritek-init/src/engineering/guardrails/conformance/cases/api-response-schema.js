"use strict";

/** Casos de conformidad R27 de `api.response-schema` (T43.4). */

const ORDER = {
  type: "object",
  additionalProperties: false,
  required: ["id", "status", "total", "items"],
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["pending", "paid", "cancelled"] },
    total: { $ref: "#/definitions/money" },
    items: { type: "array", items: { type: "object", required: ["sku", "qty"], properties: { sku: { type: "string" }, qty: { type: "integer", minimum: 1 } } } },
    note: { type: "string" },
  },
  definitions: { money: { type: "object", required: ["amount", "currency"], properties: { amount: { type: "integer" }, currency: { type: "string", pattern: "^[A-Z]{3}$" } } } },
};
const ERROR = { type: "object", required: ["code", "message"], additionalProperties: false, properties: { code: { type: "string" }, message: { type: "string" }, fields: { type: "array", items: { type: "string" } } } };

function contractDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "api.response-schema",
    errorSchema: JSON.parse(JSON.stringify(ERROR)),
    endpoints: [{ id: "create-order", method: "POST", path: "/orders", sampleBody: { items: [{ sku: "k-1", qty: 2 }] }, invalidBody: { items: [] }, responseSchema: JSON.parse(JSON.stringify(ORDER)) }],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withContract = (doc) => ({ files: { "apps/x/response-schemas.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { responseSchemaContract: "apps/x/response-schemas.json" } });
const negative = (id, adapter, rules, mutate) => ({ id, kind: "negative", ...withContract(contractDoc(adapter, mutate)), expect: { decision: "warn", rules, eligible: true } });
const permissive = (d) => delete d.endpoints[0].responseSchema.additionalProperties;

module.exports = {
  control: "api.response-schema",
  profiles: ["http-api"],
  cases: [
    { id: "respuestas-que-cumplen", kind: "positive", ...withContract(contractDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "sin-escenario-de-error", kind: "positive", ...withContract(contractDoc("good", (d) => delete d.errorSchema)), expect: { decision: "allow", rules: [], eligible: false } },
    negative("monto-como-texto", "string-amount", ["schema-mismatch"]),
    negative("falta-requerido", "missing-required", ["schema-mismatch"]),
    negative("estado-fuera-del-enum", "bad-enum", ["schema-mismatch"]),
    negative("nulo-no-declarado", "null-note", ["schema-mismatch"]),
    negative("campo-interno-expuesto", "extra-field", ["undeclared-field"], permissive),
    negative("codigo-de-exito-distinto", "wrong-status", ["response-status"]),
    negative("error-en-texto-plano", "plain-error", ["error-schema"]),
    negative("cuerpo-invalido-500", "error-500", ["error-schema", "error-status"]),
    negative("schema-no-verificable", "good", ["contract-schema-unsupported"], (d) => (d.endpoints[0].responseSchema.oneOf = [{ type: "object" }])),
    { id: "contrato-invalido", kind: "negative", ...withContract("{ roto"), expect: { decision: "warn", rules: ["contract-invalid"], eligible: true } },
    { id: "sin-contrato-inferencia", kind: "edge", files: { "apps/x/src/orders.ts": "const Order = z.object({ id: z.string() });\n" }, parameters: {}, expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withContract(contractDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withContract(contractDoc("throws")), expect: { eligible: false } },
  ],
};
