"use strict";

/**
 * Harness de migraciones compatibles (T46.2). Framework-neutral: el adapter
 * entrega las migraciones del equipo en orden de aplicación, con el SQL que
 * ejecutan (leído de los archivos o generado por su herramienta: Prisma,
 * Knex, Flyway, Alembic…):
 *
 *   createMigrationsUnderTest({ clock, deps: {} })
 *     → { migrations() → Promise<[{ id, sql }]> }
 *
 * La traza sólo lleva conteos por clase de cambio, nunca SQL ni nombres.
 */

const { analyze, KINDS } = require("./sql.js");

const HARNESS = { name: "kiritek-migrations-harness", version: "1.0.0" };
const MAX_MIGRATIONS = 5000;

async function runSuite(factory, params) {
  let list;
  try {
    const sut = factory({ clock: { now: () => 0, setTimeout, clearTimeout }, deps: {} });
    if (!sut || typeof sut.migrations !== "function") throw new Error("sin migrations()");
    list = await sut.migrations();
  } catch (_) {
    return { schemaVersion: 1, harness: HARNESS, scenarios: [{ id: "scan", status: "error", limitation: "ADAPTER_INIT_FAILED", steps: [] }] };
  }
  const valid = Array.isArray(list) && list.length <= MAX_MIGRATIONS && list.every((m) => m && typeof m.id === "string" && typeof m.sql === "string");
  const a = valid ? analyze(list, params) : null;
  const scenarios = [{ id: "scan", status: "ok", steps: [{ readable: valid && a.baselineFound, ...(a ? a.counts : Object.fromEntries(KINDS.map((k) => [k, 0]))) }] }];
  if ((params.exceptions || []).length) scenarios.push({ id: "exceptions", status: "ok", steps: [{ unbacked: a ? a.unbacked : params.exceptions.length }] });
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite };
