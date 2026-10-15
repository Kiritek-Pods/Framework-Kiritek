"use strict";

/**
 * Proceso hijo del harness: `node harness-runner.js <adapter-abs>`.
 * Parámetros en KIRITEK_SEARCH_PARAMS (JSON). Escribe la traza JSON en
 * stdout; cualquier salida del adapter (console.*, process.stdout) se desvía
 * a stderr, que no se persiste.
 */

const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => process.stderr.write(...args);
for (const m of ["log", "info", "warn", "error", "debug"]) console[m] = () => {};

(async () => {
  const { runSuite } = require("./harness.js");
  let factory;
  try {
    const mod = require(process.argv[2]);
    factory = mod.createSearchUnderTest || (mod.default && mod.default.createSearchUnderTest);
    if (typeof factory !== "function") throw new Error("sin createSearchUnderTest");
  } catch (err) {
    realWrite(JSON.stringify({ schemaVersion: 1, harness: { name: "kiritek-search-harness", version: "1.0.0" }, fatal: "ADAPTER_LOAD_FAILED", scenarios: [] }));
    process.exit(0);
  }
  const params = JSON.parse(process.env.KIRITEK_SEARCH_PARAMS || "{}");
  const trace = await runSuite(factory, params);
  realWrite(JSON.stringify(trace));
  process.exit(0);
})();
