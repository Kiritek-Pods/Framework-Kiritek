"use strict";

/**
 * Proceso hijo: `node harness-runner.js <adapter-abs>`; parámetros en
 * KIRITEK_VERSION_PARAMS. Traza JSON por stdout; la salida del adapter se
 * desvía a stderr (no se persiste).
 */

const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => process.stderr.write(...args);
for (const m of ["log", "info", "warn", "error", "debug"]) console[m] = () => {};

(async () => {
  const { runSuite } = require("./harness.js");
  let factory;
  try {
    const mod = require(process.argv[2]);
    factory = mod.createVersionGateUnderTest || (mod.default && mod.default.createVersionGateUnderTest);
    if (typeof factory !== "function") throw new Error("sin createVersionGateUnderTest");
  } catch (_) {
    realWrite(JSON.stringify({ schemaVersion: 1, harness: { name: "kiritek-version-harness", version: "1.0.0" }, fatal: "ADAPTER_LOAD_FAILED", scenarios: [] }));
    process.exit(0);
  }
  const trace = await runSuite(factory, JSON.parse(process.env.KIRITEK_VERSION_PARAMS || "{}"));
  realWrite(JSON.stringify(trace));
  process.exit(0);
})();
