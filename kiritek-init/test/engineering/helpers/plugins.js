"use strict";

// Construye plugins vendorizados de prueba (manifest + checksums + digest).
const fs = require("node:fs");
const path = require("node:path");
const { sha256Of } = require("../../../src/engineering/guardrails/canonical.js");
const { computePluginDigest, pluginDirFor, MANIFEST } = require("../../../src/engineering/guardrails/plugins/manifest.js");

const CONTROL = "acme/payments.idempotency";
const SUITE = "acme/payments-conformance";

function controlDef(over = {}) {
  return {
    schemaVersion: 1,
    id: CONTROL,
    version: "1.0.0",
    contractVersion: "1.0.0",
    profiles: { allOf: ["acme/payments"] },
    moments: [
      { moment: "pre-commit", scope: "change", network: false, budgetMs: 5000, fallback: "defer-to-later-surface" },
      { moment: "pr", scope: "change", network: false, budgetMs: 600000, fallback: "error-operational" },
    ],
    parametersSchemaRef: "parameters/idempotency.schema.json",
    supportedLevels: ["off", "warn"],
    defaults: { level: "warn", parameters: {} },
    collectors: ["acme/idempotency-collector"],
    normalizer: "acme/normalizer",
    applicability: "acme/applicability",
    evaluator: "acme/evaluator",
    costClass: "small",
    timeoutMs: 20000,
    cachePolicy: { enabled: false, ttlSeconds: 0 },
    freshness: { maxAgeSeconds: 86400 },
    permissions: { filesystemRead: ["apps/pay/**"], networkHosts: [], envNames: [], processes: [] },
    documentationRef: "docs/acme/idempotency.md",
    ...over,
  };
}

/** Collector/evaluator correctos: deny determinista si faltan claves de idempotencia. */
const GOOD_ENTRY = `"use strict";
const fs = require("fs");
const path = require("path");
exports.collectors = {
  "acme/idempotency-collector": {
    version: "1.0.0",
    collect(ctx) {
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(ctx.repoRoot, ctx.unit.root, "payments.json"), "utf8")); } catch (_) {}
      return [{ kind: "acme-idempotency", mechanism: "schema", status: "complete", confidence: "deterministic", evidenceClass: "deterministic", facts: { idempotencyKeys: !!cfg.idempotencyKeys } }];
    },
  },
};
exports.evaluators = {
  "${CONTROL}": {
    version: "1.0.0",
    evaluate(input) {
      const o = input.observations.find((x) => x.kind === "acme-idempotency");
      if (o && !o.facts.idempotencyKeys) {
        return { decision: "deny", reason: "sin claves de idempotencia", findings: [{ ruleId: "${CONTROL}/keys", path: "apps/pay/payments.json", severity: "high", fingerprint: "acme:keys", remediation: "Declare idempotencyKeys.", evidenceClass: "__CLASS__", observationRefs: [o.observationId] }] };
      }
      return { decision: "allow" };
    },
  },
};
`;

/**
 * Escribe un plugin en `<repo>/.kiritek/plugins/...` y devuelve su pin.
 * @param {object} o { entry, files, control, manifest(m), afterWrite(dir), evidenceClass }
 */
function makePlugin(repoRoot, o = {}) {
  const id = o.id || "acme/payments-guardrails";
  const version = o.version || "1.0.0";
  const dir = path.join(repoRoot, ...pluginDirFor(id, version).split("/"));
  fs.mkdirSync(path.join(dir, "parameters"), { recursive: true });
  const files = {
    "index.js": (o.entry || GOOD_ENTRY).replace("__CLASS__", o.evidenceClass || "deterministic"),
    "parameters/idempotency.schema.json": JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", type: "object", additionalProperties: false, properties: {} }),
    ...(o.files || {}),
  };
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  const manifest = {
    schemaVersion: 1,
    id,
    version,
    namespace: id.split("/")[0],
    engine: { kiritekInit: ">=0.0.0", pluginContract: 1 },
    entry: "index.js",
    profiles: [{ id: "acme/payments", version: "1.0.0", description: "Servicios que mueven dinero.", extends: [] }],
    controls: [o.control || controlDef()],
    files: Object.fromEntries(Object.entries(files).map(([rel, c]) => [rel, sha256Of(Buffer.from(c))])),
  };
  if (o.manifest) o.manifest(manifest);
  manifest.digest = computePluginDigest(manifest);
  if (o.afterDigest) o.afterDigest(manifest);
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
  if (o.afterWrite) o.afterWrite(dir);
  return { id, version, digest: manifest.digest };
}

module.exports = { CONTROL, SUITE, controlDef, GOOD_ENTRY, makePlugin };
