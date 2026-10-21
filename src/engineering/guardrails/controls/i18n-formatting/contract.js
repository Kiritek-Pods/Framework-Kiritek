"use strict";

/** Contrato de localización (T27.1): forma + hechos mínimos. */

const { loadContractFile } = require("../shared/contract-file.js");

const SCHEMA = "engineering/controls/i18n-formatting.contract";

const factsOf = (doc) => ({
  locales: [...doc.locales].sort(),
  defaultLocale: doc.defaultLocale,
  currency: doc.currency,
  formats: [...doc.formats].sort(),
  hasHarness: !!doc.harness,
  harnessKind: doc.harness ? doc.harness.kind : null,
});

function loadI18nContract(repoRoot, relPath) {
  const r = loadContractFile(repoRoot, relPath, SCHEMA);
  return r.valid ? { ...r, facts: factsOf(r.doc) } : r;
}

module.exports = { SCHEMA, loadI18nContract, factsOf };
