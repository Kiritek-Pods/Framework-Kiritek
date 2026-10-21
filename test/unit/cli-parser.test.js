"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parse, CliError } = require("../../src/cli-parser.js");

test("parse: comando simple con flag booleano y de valor", () => {
  const r = parse(["scan", "--scope=staged", "--dry-run"]);
  assert.equal(r.command, "scan");
  assert.equal(r.subcommand, null);
  assert.equal(r.flags.scope, "staged");
  assert.equal(r.flags["dry-run"], true);
});

test("parse: flag de valor con espacio (--mode enforce)", () => {
  const r = parse(["scan", "--mode", "enforce"]);
  assert.equal(r.flags.mode, "enforce");
});

test("parse: comando de dos palabras (security doctor)", () => {
  const r = parse(["security", "doctor", "--format=json"]);
  assert.equal(r.command, "security");
  assert.equal(r.subcommand, "doctor");
  assert.equal(r.flags.format, "json");
});

test("parse: subcomando desconocido se rechaza", () => {
  assert.throws(() => parse(["security", "nope"]), CliError);
});

test("parse: --no-telemetry niega el flag", () => {
  const r = parse(["scan", "--no-telemetry"]);
  assert.equal(r.flags.telemetry, false);
});

test("parse: flag desconocido se rechaza (no se ignora)", () => {
  assert.throws(() => parse(["scan", "--totally-unknown"]), /flag desconocido/);
});

test("parse: flag booleano con valor se rechaza", () => {
  assert.throws(() => parse(["scan", "--dry-run=foo"]), /no acepta valor/);
});

test("parse: flag de valor sin valor se rechaza", () => {
  assert.throws(() => parse(["scan", "--mode"]), /requiere un valor/);
});

test("parse: --version/--help sin comando", () => {
  assert.equal(parse(["--version"]).flags.version, true);
  assert.equal(parse(["--help"]).flags.help, true);
});

test("parse: positionals se conservan", () => {
  const r = parse(["provider", "plan", "github"]);
  assert.equal(r.command, "provider");
  assert.equal(r.subcommand, "plan");
  assert.deepEqual(r.positionals, ["github"]);
});
