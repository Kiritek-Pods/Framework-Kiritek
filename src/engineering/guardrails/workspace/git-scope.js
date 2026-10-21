"use strict";

/**
 * Colecta de cambios desde Git por momento (T05.3), sin shell.
 *
 * - pre-commit: índice staged exacto (`diff --cached`), nunca unstaged.
 * - pr: rango completo merge-base(base, head)..head. Si falta historia
 *   (shallow, base ausente) es error operativo `SCOPE_RANGE_INCOMPLETE`;
 *   nunca se interpreta como "sin cambios".
 * Renames se detectan (`-M`) y conservan la ruta de origen.
 */

const { spawnSync } = require("node:child_process");
const { parseNameStatusZ } = require("../../../git/staged-scope.js");
const { raise } = require("../errors.js");

function git(repoRoot, args) {
  const res = spawnSync("git", ["-C", repoRoot, "-c", "core.quotepath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (res.error) raise("SCOPE_GIT_UNAVAILABLE", `no se pudo ejecutar git: ${res.error.code || "error"}`);
  return res;
}

function assertRevArg(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("-") || /[\s\0]/.test(value)) {
    raise("SCOPE_INVALID_REVISION", `${label} inválido`, { remediation: "Pase un SHA o ref sin espacios ni prefijo '-'." });
  }
}

function headCommit(repoRoot) {
  const res = git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  return res.status === 0 ? res.stdout.trim() : null;
}

function isShallow(repoRoot) {
  const res = git(repoRoot, ["rev-parse", "--is-shallow-repository"]);
  return res.status === 0 && res.stdout.trim() === "true";
}

function toEntries(stdout) {
  return parseNameStatusZ(stdout || "").map((e) => {
    const out = { change: e.change, path: e.path };
    if (e.oldPath) out.oldPath = e.oldPath;
    return out;
  });
}

/** Cambios staged exactos para pre-commit. */
function collectStaged(repoRoot) {
  const diff = git(repoRoot, ["diff", "--cached", "-z", "--name-status", "-M", "--no-ext-diff"]);
  if (diff.status !== 0) raise("SCOPE_GIT_FAILED", "git diff --cached falló");
  const tree = git(repoRoot, ["write-tree"]);
  if (tree.status !== 0) raise("SCOPE_GIT_FAILED", "git write-tree falló (índice con conflictos)");
  const head = headCommit(repoRoot);
  return { entries: toEntries(diff.stdout), revision: head || tree.stdout.trim(), tree: tree.stdout.trim(), headPresent: !!head };
}

/** Rango completo de PR: merge-base(base, head)..head. */
function collectRange(repoRoot, base, head) {
  assertRevArg(base, "base");
  assertRevArg(head, "head");
  const shallow = isShallow(repoRoot);
  const resolve = (rev, label) => {
    const r = git(repoRoot, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    if (r.status !== 0) {
      raise("SCOPE_RANGE_INCOMPLETE", `${label} ${rev} no está disponible en este checkout${shallow ? " (repositorio shallow)" : ""}`, {
        remediation: "Haga fetch de la historia completa (fetch-depth: 0) o del commit base; el alcance no se reduce.",
      });
    }
    return r.stdout.trim();
  };
  const baseSha = resolve(base, "base");
  const headSha = resolve(head, "head");
  const mb = git(repoRoot, ["merge-base", baseSha, headSha]);
  if (mb.status !== 0 || !mb.stdout.trim()) {
    raise("SCOPE_RANGE_INCOMPLETE", `no hay merge-base entre base y head${shallow ? " (repositorio shallow)" : ""}`, {
      remediation: "Profundice la historia (git fetch --deepen / --unshallow); no se evalúa un rango parcial.",
    });
  }
  const mergeBase = mb.stdout.trim();
  const diff = git(repoRoot, ["diff", "-z", "--name-status", "-M", "--no-ext-diff", mergeBase, headSha]);
  if (diff.status !== 0) raise("SCOPE_GIT_FAILED", "git diff del rango falló");
  return { entries: toEntries(diff.stdout), revision: headSha, baseRevision: baseSha, mergeBase, shallow };
}

module.exports = { git, headCommit, isShallow, collectStaged, collectRange };
