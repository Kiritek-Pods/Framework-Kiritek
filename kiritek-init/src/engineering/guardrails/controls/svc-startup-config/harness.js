"use strict";

/**
 * Harness conductual de configuración al arrancar (T49.2). Framework-
 * neutral: el adapter arranca el servicio real con el entorno que recibe, en
 * vez de `process.env`:
 *
 *   startService({ env, logger, clock }) → Promise<servicio> | servicio
 *
 * Arrancar bien es resolver; negarse es lanzar o rechazar dentro de 5 s
 * virtuales (fail fast). El mensaje de error y lo que se escriba con
 * `logger.write(line)` deben nombrar la variable, sin mostrar secretos.
 */

const { createVirtualClock } = require("../shared/virtual-clock.js");
const { settle } = require("../shared/settle.js");
const { slug, scenarioIds, MAX_VARIABLES } = require("./scenarios.js");

const HARNESS = { name: "kiritek-startup-config-harness", version: "1.0.0" };
const T0 = Date.UTC(2026, 5, 1);
const LIMIT_MS = 5000;

const secretOf = (name) => `kcanary-secret-${name.toLowerCase()}-7f3a`;
function validValue(v) {
  if (v.example !== null) return v.example;
  return { url: "https://kiritek.test/servicio", int: "8080", enum: (v.values || ["x"])[0], bool: "true", secret: secretOf(v.name), string: "kval-config" }[v.kind];
}
const INVALID = { url: "no-es-una-url", int: "ocho", enum: "kiritek-valor-invalido", bool: "quizas" };

async function attempt(factory, env) {
  const clock = createVirtualClock(T0);
  const lines = [];
  const logger = { write: (l) => void lines.push(String(l)) };
  const state = await settle(() => factory({ env: { ...env }, logger, clock: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout } }), clock, LIMIT_MS);
  const err = state && !state.ok ? state.error : null;
  const text = [...lines, err ? `${err && err.message} ${String(err)} ${(err && err.stack) || ""}` : ""].join("\n");
  return { started: !!state && state.ok, refused: !!state && !state.ok, text };
}

async function runScenario(id, factory, vars) {
  const full = Object.fromEntries(vars.map((v) => [v.name, validValue(v)]));
  const [scenario, target] = id.split("@");
  const v = vars.find((x) => slug(x.name) === target);
  const names = (text, name) => text.includes(name);
  let step;
  try {
    if (scenario === "valid") {
      step = { started: (await attempt(factory, full)).started };
    } else if (scenario === "missing" || scenario === "invalid") {
      const env = { ...full };
      if (scenario === "missing") delete env[v.name];
      else env[v.name] = INVALID[v.kind];
      const a = await attempt(factory, env);
      step = { refused: a.refused, namesVariable: !a.refused || names(a.text, v.name) };
    } else if (scenario === "optional") {
      const env = { ...full };
      delete env[v.name];
      step = { started: (await attempt(factory, env)).started };
    } else {
      const bad = vars.find((x) => x.kind !== "secret" && ["url", "int", "enum", "bool"].includes(x.kind)) || vars.find((x) => x.kind !== "secret" && x.required);
      const env = { ...full };
      if (["url", "int", "enum", "bool"].includes(bad.kind)) env[bad.name] = INVALID[bad.kind];
      else delete env[bad.name];
      const a = await attempt(factory, env);
      step = { noSecret: !vars.filter((x) => x.kind === "secret").some((x) => a.text.includes(String(full[x.name]))) };
    }
  } catch (_) {
    return { id, status: "error", limitation: "HARNESS_ERROR", steps: [] };
  }
  return { id, status: "ok", steps: [step] };
}

async function runSuite(factory, params) {
  const vars = (params.variables || []).slice(0, MAX_VARIABLES);
  const scenarios = [];
  for (const id of scenarioIds({ variables: vars })) scenarios.push(await runScenario(id, factory, vars));
  return { schemaVersion: 1, harness: HARNESS, scenarios };
}

module.exports = { HARNESS, runSuite, runScenario, validValue, secretOf };
