"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveConfig } = require("../../src/config/precedence.js");
const { loadProjectConfig, loadEffectiveConfig, CONFIG_FILENAME } = require("../../src/config/load.js");
const { DEFAULT_CONFIG } = require("../../src/config/defaults.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-cfg-"));
}

test("resolveConfig: sin fuentes usa defaults y marca origen default", () => {
  const { config, origin } = resolveConfig({ flags: {}, env: {} });
  assert.equal(config.mode, "warning");
  assert.equal(config.git.forcePolicy, "deny");
  assert.equal(origin.mode, "default");
});

test("resolveConfig: precedencia flag > env > project > default", () => {
  const projectConfig = { version: 1, mode: "warning", git: { forcePolicy: "lease-only" } };
  const { config, origin } = resolveConfig({
    flags: { "force-policy": "allow" },
    env: { KIRITEK_FORCE_POLICY: "deny" },
    projectConfig,
  });
  // flag gana
  assert.equal(config.git.forcePolicy, "allow");
  assert.equal(origin["force-policy"], "flag");
});

test("resolveConfig: env gana sobre project cuando no hay flag", () => {
  const projectConfig = { version: 1, mode: "warning", jira: { enabled: false } };
  const { config, origin } = resolveConfig({
    flags: {},
    env: { KIRITEK_JIRA: "true" },
    projectConfig,
  });
  assert.equal(config.jira.enabled, true);
  assert.equal(origin.jira, "env");
});

test("resolveConfig: valor inválido de enum lanza", () => {
  assert.throws(() => resolveConfig({ flags: { mode: "turbo" }, env: {} }), /valor inválido para mode/);
});

test("resolveConfig: --security=off se expone aparte, no muta mode", () => {
  const { security } = resolveConfig({ flags: { security: "off" }, env: {} });
  assert.equal(security, "off");
});

test("resolveConfig: --security=enforce ajusta mode a enforce", () => {
  const { config, security } = resolveConfig({ flags: { security: "enforce" }, env: {} });
  assert.equal(security, "enforce");
  assert.equal(config.mode, "enforce");
});

test("loadProjectConfig: devuelve null si no existe", () => {
  const repo = tmpRepo();
  try {
    assert.equal(loadProjectConfig(repo), null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("loadProjectConfig: JSON inválido lanza CONFIG_PARSE_ERROR", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, CONFIG_FILENAME), "{ not json");
    assert.throws(() => loadProjectConfig(repo), (e) => e.code === "CONFIG_PARSE_ERROR");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("loadProjectConfig: config que no cumple schema lanza CONFIG_INVALID", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, CONFIG_FILENAME), JSON.stringify({ version: 1, mode: "nope" }));
    assert.throws(() => loadProjectConfig(repo), (e) => e.code === "CONFIG_INVALID");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("loadEffectiveConfig: ignora $schema y valida el resultado", () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(
      path.join(repo, CONFIG_FILENAME),
      JSON.stringify({ $schema: "x", version: 1, mode: "enforce" })
    );
    const { config } = loadEffectiveConfig({ repoRoot: repo, flags: {}, env: {} });
    assert.equal(config.mode, "enforce");
    assert.ok(!("$schema" in config));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("plantilla instalable: la config de template cumple el schema por defecto", () => {
  const tpl = path.join(
    __dirname, "..", "..", "templates", "core", "security", "config", "kiritek-security.config.json"
  );
  const parsed = JSON.parse(fs.readFileSync(tpl, "utf8"));
  delete parsed.$schema;
  // Debe resolverse y validar sin lanzar.
  const { config } = resolveConfig({ flags: {}, env: {}, projectConfig: parsed });
  assert.equal(config.version, DEFAULT_CONFIG.version);
});
