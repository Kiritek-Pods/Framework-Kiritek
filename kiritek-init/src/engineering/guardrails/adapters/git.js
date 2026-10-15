"use strict";

/**
 * Integración Git pre-commit engineering (T14.4).
 *
 * - Evalúa el índice staged exacto (`resolveScope` pre-commit), offline y
 *   sólo con checks rápidos (los harness se difieren a PR).
 * - Composición idempotente y no destructiva (R13.5):
 *     · sin hook             ⇒ instala el dispatcher engineering;
 *     · hook del usuario     ⇒ lo preserva en `.kiritek/hooks/engineering/
 *                              pre-commit.previous` y lo encadena;
 *     · dispatcher propio    ⇒ reinstalación idempotente (noop si igual);
 *     · hook de security, gestor de terceros (Husky, Lefthook…) o
 *       `core.hooksPath` propio ⇒ NO se toca: integración manual con una
 *       línea verificable (`verifyGitIntegration`).
 * - Nunca escribe ni mueve artefactos de `core/security`.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MARKER = "kiritek-engineering-hook";
const SECURITY_MARKER = "Kiritek managed";
const HOOK_SCRIPT = ".kiritek/hooks/engineering/pre-commit";
const PREVIOUS = ".kiritek/hooks/engineering/pre-commit.previous";
const INVOCATION = `sh "$(git rev-parse --show-toplevel)/${HOOK_SCRIPT}" || exit $?`;
const MANAGERS = Object.freeze([
  { manager: "husky", files: [".husky"] },
  { manager: "lefthook", files: ["lefthook.yml", ".lefthook.yml", "lefthook.yaml"] },
  { manager: "pre-commit", files: [".pre-commit-config.yaml"] },
  { manager: "captainhook", files: ["captainhook.json", ".captainhook.json"] },
]);
const TEMPLATE = path.join(__dirname, "..", "..", "..", "..", "templates", "engineering", "guardrails", "hooks", "pre-commit");

function hookScript() {
  return fs.readFileSync(TEMPLATE, "utf8");
}

/** Dispatcher instalado en `.git/hooks/pre-commit`: encadena el previo y llama al script. */
function dispatcher() {
  return [
    "#!/bin/sh",
    `# ${MARKER}: dispatcher pre-commit del pack engineering/guardrails (Kiritek).`,
    "# Encadena el hook previo preservado y luego el gate engineering (warning-only",
    "# salvo deny elegible). Idempotente; desinstalar restaura el hook previo.",
    'ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0',
    `PREV="$ROOT/${PREVIOUS}"`,
    'if [ -x "$PREV" ]; then "$PREV" "$@" || exit $?; fi',
    `sh "$ROOT/${HOOK_SCRIPT}" || exit $?`,
    "exit 0",
    "",
  ].join("\n");
}

/**
 * Directorio de hooks efectivo. `--git-path hooks` resuelve worktrees (donde
 * `.git` es un archivo y los hooks viven en el repo común) y `core.hooksPath`.
 */
function hooksDir(repoRoot) {
  const res = spawnSync("git", ["-C", repoRoot, "config", "--get", "core.hooksPath"], { encoding: "utf8" });
  const custom = res.status === 0 ? res.stdout.trim() : "";
  if (custom) return { custom, dir: path.resolve(repoRoot, custom) };
  const gp = spawnSync("git", ["-C", repoRoot, "rev-parse", "--git-path", "hooks"], { encoding: "utf8" });
  const dir = gp.status === 0 && gp.stdout.trim() ? path.resolve(repoRoot, gp.stdout.trim()) : path.join(repoRoot, ".git", "hooks");
  return { custom: null, dir };
}

/** Plan de composición (puro salvo lecturas). */
function planGitIntegration(repoRoot) {
  const manager = MANAGERS.find((m) => m.files.some((f) => fs.existsSync(path.join(repoRoot, f))));
  if (manager) return { strategy: "manual", reason: `gestor de hooks ${manager.manager}`, snippet: INVOCATION };
  const { custom, dir } = hooksDir(repoRoot);
  if (custom) return { strategy: "manual", reason: `core.hooksPath=${custom}`, snippet: INVOCATION };
  const target = path.join(dir, "pre-commit");
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (existing === null) return { strategy: "install", target };
  if (existing.includes(MARKER)) return { strategy: existing === dispatcher() ? "noop" : "reinstall", target };
  if (existing.includes(SECURITY_MARKER)) return { strategy: "manual", reason: "hook de core/security presente (no se modifica)", snippet: INVOCATION };
  return { strategy: "chain", target };
}

function writeExec(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.kiritek-tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o755 });
  fs.renameSync(tmp, abs);
  fs.chmodSync(abs, 0o755);
}

/** Aplica el plan. El script del gate siempre se escribe (es del pack). */
function installGitIntegration(repoRoot, { dryRun = false } = {}) {
  const plan = planGitIntegration(repoRoot);
  if (dryRun) return { ...plan, applied: false };
  writeExec(path.join(repoRoot, HOOK_SCRIPT), hookScript());
  if (plan.strategy === "chain") {
    writeExec(path.join(repoRoot, PREVIOUS), fs.readFileSync(plan.target));
  }
  if (["install", "chain", "reinstall"].includes(plan.strategy)) writeExec(plan.target, dispatcher());
  return { ...plan, applied: plan.strategy !== "manual" };
}

/** Restaura el hook previo y quita sólo lo del pack. */
function uninstallGitIntegration(repoRoot) {
  const { dir } = hooksDir(repoRoot);
  const target = path.join(dir, "pre-commit");
  const prev = path.join(repoRoot, PREVIOUS);
  let restored = false;
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8").includes(MARKER)) {
    if (fs.existsSync(prev)) {
      writeExec(target, fs.readFileSync(prev));
      restored = true;
    } else fs.rmSync(target);
  }
  fs.rmSync(prev, { force: true });
  fs.rmSync(path.join(repoRoot, HOOK_SCRIPT), { force: true });
  return { restored };
}

/**
 * ¿El gate engineering corre en pre-commit? Verifica el dispatcher propio o
 * la línea de integración manual en el hook efectivo / config del gestor.
 */
function verifyGitIntegration(repoRoot) {
  const scriptPresent = fs.existsSync(path.join(repoRoot, HOOK_SCRIPT));
  const candidates = [path.join(hooksDir(repoRoot).dir, "pre-commit"), ...MANAGERS.flatMap((m) => m.files.map((f) => path.join(repoRoot, f)))];
  const extra = [path.join(repoRoot, ".husky", "pre-commit")];
  let wired = false;
  for (const file of [...candidates, ...extra]) {
    try {
      if (fs.statSync(file).isFile() && fs.readFileSync(file, "utf8").includes(HOOK_SCRIPT)) wired = true;
    } catch (_) {
      /* no existe */
    }
  }
  return { verified: scriptPresent && wired, scriptPresent, wired };
}

module.exports = { MARKER, HOOK_SCRIPT, PREVIOUS, INVOCATION, hooksDir, dispatcher, planGitIntegration, installGitIntegration, uninstallGitIntegration, verifyGitIntegration };
