"use strict";

/** Plan de tracking (T25.1): forma + hechos mínimos. */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/analytics-events.contract";

function factsOf(doc) {
  return {
    events: doc.events
      .map((e) => ({ name: e.name, properties: e.properties.map((p) => ({ name: p.name, type: p.type, required: p.required, ...(p.enum ? { enum: [...p.enum] } : {}) })) }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadTrackingPlan(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { prefix: "PLAN", uniqueIds: (d) => unique(d.events, (e) => e.name) && d.events.every((e) => unique(e.properties, (p) => p.name)) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadTrackingPlan, factsOf };
