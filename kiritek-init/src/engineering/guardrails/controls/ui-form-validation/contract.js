"use strict";

/** Contrato de formularios (T19.1): forma + hechos mínimos (sin textos). */

const { loadContractFile, unique } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/ui-form-validation.contract";

function factsOf(doc) {
  return {
    forms: doc.forms
      .map((f) => ({ id: f.id, fields: f.fields.map((x) => ({ name: x.name, required: x.required, format: x.format, ...(x.minLength ? { minLength: x.minLength } : {}), ...(x.maxLength ? { maxLength: x.maxLength } : {}) })) }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    hasHarness: !!doc.harness,
    harnessKind: doc.harness ? doc.harness.kind : null,
  };
}

function loadFormsContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA, { uniqueIds: (d) => unique(d.forms, (f) => f.id) && d.forms.every((f) => unique(f.fields, (x) => x.name)) });
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadFormsContract, factsOf };
