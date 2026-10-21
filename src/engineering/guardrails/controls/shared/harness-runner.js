"use strict";

/**
 * Proceso hijo genérico de los harness conductuales (T18–T21):
 *
 *   node harness-runner.js <harness.js> <factory> <adapter-abs>
 *
 * Parámetros en KIRITEK_HARNESS_PARAMS. La traza JSON va por stdout; la salida
 * del adapter se desvía a stderr (no se persiste).
 */

const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => process.stderr.write(...args);
for (const m of ["log", "info", "warn", "error", "debug"]) console[m] = () => {};

(async () => {
  const [harnessPath, factoryName, adapterPath] = process.argv.slice(2);
  const harness = require(harnessPath);
  let factory;
  try {
    const mod = require(adapterPath);
    factory = mod[factoryName] || (mod.default && mod.default[factoryName]);
    if (typeof factory !== "function") throw new Error(`sin ${factoryName}`);
  } catch (_) {
    realWrite(JSON.stringify({ schemaVersion: 1, harness: harness.HARNESS, fatal: "ADAPTER_LOAD_FAILED", scenarios: [] }));
    process.exit(0);
  }
  const trace = await harness.runSuite(factory, JSON.parse(process.env.KIRITEK_HARNESS_PARAMS || "{}"));
  realWrite(JSON.stringify(trace));
  process.exit(0);
})();
