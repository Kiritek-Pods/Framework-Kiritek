"use strict";

/**
 * Escaneo del alcance pre-push: evalúa los archivos tocados por los commits
 * nuevos del rango que se enviaría al remoto.
 *
 * Reutiliza push-scope (qué commits) y el motor de políticas (qué archivos son
 * sensibles). Los archivos se leen del blob de cada commit (git show
 * <sha>:<path>) para no depender del árbol de trabajo.
 *
 * (Requisitos 3.2–3.3, 3.7, G.3, G.5.)
 */

const { spawnSync } = require("child_process");

const { computePushScope } = require("../git/push-scope.js");
const engine = require("../policy/engine.js");
const commits = require("../policy/commits.js");

function git(repoRoot, args, encoding = "utf8") {
  const res = spawnSync("git", ["-C", repoRoot, ...args], { encoding, maxBuffer: 50 * 1024 * 1024 });
  if (res.error) throw res.error;
  return res;
}

/** Archivos añadidos/modificados por un commit (no borrados). */
function filesInCommit(repoRoot, sha) {
  const res = git(repoRoot, ["show", "--no-renames", "--name-status", "--format=", "-z", sha]);
  if (res.status !== 0) return [];
  const parts = res.stdout.split("\0").filter(Boolean);
  const files = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    const code = status[0];
    if (code === "R" || code === "C") {
      files.push({ path: parts[i + 2], change: code });
      i += 3;
    } else {
      if (code !== "D") files.push({ path: parts[i + 1], change: code });
      i += 2;
    }
  }
  return files;
}

/** Contenido de una ruta en un commit; null si binario/ausente. */
function contentAt(repoRoot, sha, relPath) {
  const res = git(repoRoot, ["show", `${sha}:${relPath}`], "buffer");
  if (res.status !== 0 || !res.stdout) return null;
  const buf = res.stdout;
  if (buf.subarray(0, 8192).includes(0)) return null; // binario
  return buf.toString("utf8");
}

/**
 * Escanea el alcance pre-push.
 *
 * @param {object} opts { repoRoot, stdin, remote, mode, exceptions }
 * @returns {{ result, commits: string[], files: object[] }}
 */
function scanPush(opts) {
  const { repoRoot, stdin, mode } = opts;
  const scope = computePushScope({ repoRoot, stdin, remote: opts.remote || "origin" });

  // Deduplicar por ruta: basta la última aparición del contenido en el rango.
  const byPath = new Map();
  for (const sha of scope.commits) {
    for (const f of filesInCommit(repoRoot, sha)) {
      byPath.set(f.path, { path: f.path, content: contentAt(repoRoot, sha, f.path) });
    }
  }
  const files = [...byPath.values()];

  const result = engine.evaluateFiles(
    { event: "pre-push", mode, files: files.map((f) => ({ path: f.path, content: f.content })) },
    { exceptions: opts.exceptions || [] }
  );

  return { result, commits: scope.commits, files };
}

/** Mensaje completo (subject + body) de un commit. */
function commitMessage(repoRoot, sha) {
  const res = git(repoRoot, ["show", "-s", "--format=%B", sha]);
  if (res.status !== 0) return "";
  return res.stdout;
}

/**
 * Extrae las claves Jira SINTÁCTICAS del alcance de un push, para que pre-push
 * y CI validen remotamente EXACTAMENTE las mismas claves (paridad, 10.1–10.2).
 *
 * Reutiliza el extractor sintáctico de `policy/commits.js` sobre el mensaje de
 * cada commit del rango y, opcionalmente, el nombre de rama y metadata de PR.
 * Devuelve claves deduplicadas en orden de aparición.
 *
 * @param {object} opts { repoRoot, stdin, remote, config, branch, pr }
 * @returns {{ keys: string[], commits: string[] }}
 */
function jiraKeysForPush(opts) {
  const scope = computePushScope({ repoRoot: opts.repoRoot, stdin: opts.stdin, remote: opts.remote || "origin" });
  const jiraPolicy = commits.resolveJiraPolicy(opts.config || {});
  const seen = new Set();
  const keys = [];

  const collect = (message) => {
    const extracted = commits.extractJiraKeys(
      { message, branch: opts.branch, pr: opts.pr },
      jiraPolicy
    );
    for (const k of extracted.keys) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  };

  for (const sha of scope.commits) {
    collect(commitMessage(opts.repoRoot, sha));
  }
  // Rama/PR aportan claves aunque no haya commits en el rango (p. ej. delete).
  if (scope.commits.length === 0 && (opts.branch || opts.pr)) collect("");

  return { keys, commits: scope.commits };
}

module.exports = { scanPush, filesInCommit, contentAt, commitMessage, jiraKeysForPush };
