"use strict";

// Entorno de pipeline para tests de T06: catálogo 1.1.0 con
// search.input-rate capaz de enforce (suite aprobada, sólo en pr), config de
// dos unidades, alcance sintético y controles falsos configurables.
const fs = require("node:fs");
const { resolveCatalog, createCatalogSession } = require("../../../src/engineering/guardrails/catalog/resolve.js");
const { resolveEngineeringConfig } = require("../../../src/engineering/guardrails/config/index.js");
const { resolveUnits } = require("../../../src/engineering/guardrails/workspace/units.js");
const { scopeHashFor } = require("../../../src/engineering/guardrails/workspace/scope.js");
const { evaluateRun } = require("../../../src/engineering/guardrails/orchestrator.js");
const H = require("./catalogs.js");

const CONTROL = "search.input-rate";
const COLLECTOR = "search-input-rate/collector";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const BASE = "89abcdef0123456789abcdef0123456789abcdef";
const NOW = "2026-10-05T12:00:00.000Z";
const APPROVED = ["test/engineering/contract/search-input-rate@1.0.0"];

let catalogDir = null;
function catalogOptions() {
  if (!catalogDir) {
    catalogDir = H.tmpDir("kiritek-eng-pipe-");
    H.writeCatalog(catalogDir, H.buildFiles((d) => {
      d.version = "1.1.0";
      const ctl = d.controls[0];
      ctl.supportedLevels = ["off", "warn", "enforce"];
      ctl.enforcementContract = { evidenceTypes: ["deterministic"], conformanceSuite: "test/engineering/contract/search-input-rate", approvedVersion: "1.0.0", moments: ["pr", "release"] };
    }));
    process.on("exit", () => fs.rmSync(catalogDir, { recursive: true, force: true }));
  }
  return { roots: [catalogDir], approvedConformanceSuites: APPROVED };
}

function configDoc({ level = "enforce", webProfiles = ["web", "search"], extraUnits = [] } = {}) {
  return {
    schemaVersion: 1,
    pack: { id: "engineering/guardrails", catalog: "1.1.0" },
    workspace: {
      units: [
        { id: "acme/web", root: "apps/web", kind: "application", profiles: webProfiles.map((id) => ({ id, version: "1.0.0" })), owns: ["apps/web/**"], controls: { [CONTROL]: { level } } },
        { id: "acme/docs", root: "apps/docs", kind: "application", profiles: [{ id: "web", version: "1.0.0" }], owns: ["apps/docs/**"] },
        ...extraUnits,
      ],
    },
  };
}

/** Construye config + catálogo + unidades + alcance (sólo acme/web en alcance). */
function environment(opts = {}) {
  const catOpts = catalogOptions();
  const session = createCatalogSession(catOpts);
  const resolvedConfig = resolveEngineeringConfig({ document: configDoc(opts), env: {}, catalogSession: session });
  const catalogSnapshot = session.snapshot;
  const resolvedUnits = resolveUnits(resolvedConfig, catalogSnapshot);
  const moment = opts.moment || "pr";
  const unitScope = { unitId: "acme/web", coverage: "direct", reasons: ["owns:apps/web/**"], paths: ["apps/web/search.ts"] };
  const scope = {
    moment,
    revision: HEAD,
    baseRevision: moment === "pr" ? BASE : null,
    units: [{ ...unitScope, scopeHash: scopeHashFor({ moment, revision: HEAD, baseRevision: moment === "pr" ? BASE : null, unit: unitScope }) }],
    diagnostics: [],
  };
  return { resolvedConfig, catalogSnapshot, resolvedUnits, scope, moment };
}

/** Observación cruda determinista de ráfaga (falla: 4 requests, permitido 1). */
function burstObservation(over = {}) {
  return {
    kind: "search-behavior",
    mechanism: "test",
    status: "complete",
    confidence: "deterministic",
    evidenceClass: "deterministic",
    facts: { scenario: "burst", requestsStarted: 4, maxAllowed: 1 },
    ...over,
  };
}

/** Evaluator que exige ≤ maxAllowed y cita la observación. */
const strictEvaluator = {
  version: "1.0.0",
  evaluate(input) {
    const findings = [];
    for (const o of input.observations) {
      if (o.kind === "search-behavior" && o.facts.requestsStarted > o.facts.maxAllowed) {
        findings.push({
          ruleId: `${CONTROL}/cadence`,
          path: input.scope.paths[0],
          severity: "high",
          fingerprint: `fp-${o.observationId}`,
          remediation: "Aplicar debounce/throttle según la política.",
          evidenceClass: "deterministic",
          observationRefs: [o.observationId],
        });
      }
    }
    return findings.length ? { decision: "deny", findings } : { decision: "allow" };
  },
};

function fakeControl({ observations = [burstObservation()], collect, evaluator = strictEvaluator, applicability, normalizer } = {}) {
  return {
    [CONTROL]: {
      collectors: [{ id: COLLECTOR, version: "1.0.0", collect: collect || (() => observations) }],
      evaluator,
      ...(applicability ? { applicability } : {}),
      ...(normalizer ? { normalizer } : {}),
    },
  };
}

async function run(opts = {}) {
  const env = opts.env || environment(opts);
  return evaluateRun({
    ...env,
    controls: opts.controls || fakeControl(opts.control),
    exceptions: opts.exceptions,
    suggestions: opts.suggestions,
    clock: () => NOW,
    platformKey: "test-platform",
    adapter: opts.adapter,
    verifyDeterminism: opts.verifyDeterminism,
  });
}

function envelopeOf(report, unitId = "acme/web", controlId = CONTROL) {
  return report.results.find((e) => e.unit.id === unitId && e.control.id === controlId);
}

module.exports = { CONTROL, COLLECTOR, HEAD, BASE, NOW, catalogOptions, configDoc, environment, burstObservation, strictEvaluator, fakeControl, run, envelopeOf, resolveCatalog };
