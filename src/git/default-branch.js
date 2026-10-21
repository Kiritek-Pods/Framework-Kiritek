"use strict";

/**
 * Resolución dinámica de la rama default.
 *
 * No se asume `main`. Precedencia documentada:
 *   1. configuración explícita (kiritek-security.config.json / flag)
 *   2. symbolic ref del remoto (refs/remotes/<remote>/HEAD)
 *   3. (futuro) API del proveedor — se deja el hook pero no se llama aquí
 *   4. upstream verificable del branch actual
 *
 * Si las fuentes de confianza discrepan, se devuelve AMBIGUOUS y el llamador
 * debe exigir configuración explícita en enforcement.
 *
 * (Requisitos 8.1–8.5.)
 */

const { spawnSync } = require("child_process");

const BRANCH_RE = /^[A-Za-z0-9._\/-]+$/;

function git(repoRoot, args) {
  const res = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  if (res.error) return { status: 1, stdout: "", stderr: String(res.error.message) };
  return res;
}

function validBranchName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 255 && BRANCH_RE.test(name);
}

/**
 * Lee el symbolic ref del remoto, si está configurado.
 * @returns {string|null} nombre de rama (sin refs/remotes/<remote>/).
 */
function remoteHead(repoRoot, remote) {
  const res = git(repoRoot, ["symbolic-ref", `refs/remotes/${remote}/HEAD`]);
  if (res.status !== 0) return null;
  const ref = res.stdout.trim(); // refs/remotes/origin/main
  const prefix = `refs/remotes/${remote}/`;
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

/**
 * Resuelve la rama default.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} [opts.remote="origin"]
 * @param {string|null} [opts.explicit]  Config/flag explícito.
 * @param {(repoRoot) => string|null} [opts.providerLookup]  Hook opcional.
 * @param {() => number} [opts.now]
 * @returns {{ branch: string|null, source: string, candidates: object, ambiguous: boolean, resolvedAt: string }}
 */
function resolveDefaultBranch(opts) {
  const { repoRoot } = opts;
  const remote = opts.remote || "origin";
  const now = opts.now ? opts.now() : Date.now();
  const resolvedAt = new Date(now).toISOString();

  const candidates = {};

  if (opts.explicit) {
    if (!validBranchName(opts.explicit)) {
      throw new Error(`rama default explícita inválida: ${opts.explicit}`);
    }
    candidates.explicit = opts.explicit;
    // La explícita gana siempre.
    return { branch: opts.explicit, source: "explicit", candidates, ambiguous: false, resolvedAt };
  }

  const rHead = remoteHead(repoRoot, remote);
  if (rHead && validBranchName(rHead)) candidates.remoteHead = rHead;

  if (typeof opts.providerLookup === "function") {
    try {
      const p = opts.providerLookup(repoRoot);
      if (p && validBranchName(p)) candidates.provider = p;
    } catch (_) {
      /* el proveedor es best-effort */
    }
  }

  const trusted = [candidates.remoteHead, candidates.provider].filter(Boolean);
  const unique = [...new Set(trusted)];

  if (unique.length === 1) {
    const source = candidates.remoteHead === unique[0] ? "remote-head" : "provider";
    return { branch: unique[0], source, candidates, ambiguous: false, resolvedAt };
  }
  if (unique.length > 1) {
    // Fuentes de confianza discrepan.
    return { branch: null, source: "conflict", candidates, ambiguous: true, resolvedAt };
  }

  // Sin fuentes de confianza: no se asume main.
  return { branch: null, source: "none", candidates, ambiguous: true, resolvedAt };
}

/**
 * Detecta drift entre un valor cacheado/configurado y el remoto actual.
 */
function detectDrift(repoRoot, remote, cachedBranch) {
  const current = remoteHead(repoRoot, remote);
  if (!current || !cachedBranch) return { drift: false, current, cachedBranch };
  return { drift: current !== cachedBranch, current, cachedBranch };
}

module.exports = {
  BRANCH_RE,
  validBranchName,
  remoteHead,
  resolveDefaultBranch,
  detectDrift,
};
