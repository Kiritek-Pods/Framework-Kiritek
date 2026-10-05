"use strict";

/**
 * Parser estricto y cálculo de alcance del hook pre-push.
 *
 * Git entrega al hook pre-push, por stdin, una línea por ref a actualizar:
 *   <local-ref> SP <local-sha> SP <remote-ref> SP <remote-sha> LF
 *
 * El objetivo es determinar EXACTAMENTE qué commits nuevos se enviarían, para
 * escanearlos antes de que lleguen al remoto. Reglas:
 *  - delete (local-sha = ceros): no hay contenido nuevo, se marca delete.
 *  - ref existente en remoto: rango `remoteSha..localSha`.
 *  - ref nueva (remote-sha = ceros): se calcula contra las refs ya anunciadas
 *    por el remoto (lo ya presente); si no se puede acotar, se AMPLÍA a todos
 *    los objetos alcanzables, nunca se reduce en silencio.
 *  - cada ref se evalúa por separado; los commits se deduplican.
 *
 * Todo con `spawnSync` y argumentos separados.
 *
 * (Requisitos 3.2–3.3, 3.7–3.8, 7.6, 8, 23.3–23.5, G.3, G.5.)
 */

const { spawnSync } = require("child_process");

const ZERO = /^0{40}$|^0{64}$/; // sha-1 o sha-256 "cero"
const SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

const UPDATE_KIND = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
});

function git(repoRoot, args) {
  const res = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (res.error) throw res.error;
  return res;
}

/**
 * Parsea el stdin del hook pre-push de forma estricta.
 * Líneas malformadas se rechazan (no se ignoran silenciosamente).
 *
 * @param {string} stdin
 * @returns {Array<{localRef, localSha, remoteRef, remoteSha, kind, isTag}>}
 */
function parsePrePushStdin(stdin) {
  const lines = String(stdin || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((line) => {
    const parts = line.split(/\s+/);
    if (parts.length !== 4) {
      throw new Error(`línea pre-push malformada: ${JSON.stringify(line)}`);
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts;

    for (const [label, sha] of [["localSha", localSha], ["remoteSha", remoteSha]]) {
      if (!ZERO.test(sha) && !SHA_RE.test(sha)) {
        throw new Error(`${label} inválido en pre-push: ${sha}`);
      }
    }

    const localZero = ZERO.test(localSha);
    const remoteZero = ZERO.test(remoteSha);

    let kind;
    if (localZero) kind = UPDATE_KIND.DELETE;
    else if (remoteZero) kind = UPDATE_KIND.CREATE;
    else kind = UPDATE_KIND.UPDATE;

    const isTag = remoteRef.startsWith("refs/tags/");
    return { localRef, localSha, remoteRef, remoteSha, kind, isTag };
  });
}

/**
 * revList: lista de commits en un rango.
 */
function revList(repoRoot, range) {
  const res = git(repoRoot, ["rev-list", range]);
  if (res.status !== 0) return null;
  return res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Refs ya presentes en el remoto (para acotar ramas nuevas). Se usan las
 * refs remotas conocidas localmente (refs/remotes/<remote>/*).
 */
function remoteTips(repoRoot, remote) {
  const res = git(repoRoot, ["for-each-ref", "--format=%(objectname)", `refs/remotes/${remote}/`]);
  if (res.status !== 0) return [];
  return res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Calcula los commits nuevos de una actualización de ref.
 * @returns {{ commits: string[], base: string|null, reason: string }}
 */
function commitsForUpdate(repoRoot, update, remote) {
  if (update.kind === UPDATE_KIND.DELETE) {
    return { commits: [], base: null, reason: "delete: sin contenido nuevo" };
  }
  if (update.kind === UPDATE_KIND.UPDATE) {
    const commits = revList(repoRoot, `${update.remoteSha}..${update.localSha}`);
    if (commits) return { commits, base: update.remoteSha, reason: "update: remoteSha..localSha" };
    // Si falla (p. ej. historial disjunto), ampliar.
    return widen(repoRoot, update, remote, "update: rango no computable, ampliado");
  }
  // CREATE: acotar contra lo ya presente en el remoto.
  const tips = remoteTips(repoRoot, remote);
  if (tips.length > 0) {
    const excludes = tips.map((t) => `^${t}`);
    const res = git(repoRoot, ["rev-list", update.localSha, ...excludes]);
    if (res.status === 0) {
      const commits = res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      return { commits, base: tips.join(","), reason: "create: acotado contra tips remotos" };
    }
  }
  return widen(repoRoot, update, remote, "create: sin tips remotos, todos los commits alcanzables");
}

function widen(repoRoot, update, remote, reason) {
  const commits = revList(repoRoot, update.localSha) || [update.localSha];
  return { commits, base: null, reason };
}

/**
 * Calcula el alcance completo del push: deduplica commits de todas las refs.
 *
 * @param {object} opts { repoRoot, stdin, remote }
 * @returns {{ updates, commits: string[], tags: object[], deletes: object[], reasons: object[] }}
 */
function computePushScope(opts) {
  const { repoRoot, stdin } = opts;
  const remote = opts.remote || "origin";
  const updates = parsePrePushStdin(stdin);

  const commitSet = new Set();
  const reasons = [];
  const tags = [];
  const deletes = [];

  for (const u of updates) {
    if (u.kind === UPDATE_KIND.DELETE) deletes.push(u);
    if (u.isTag) tags.push(u);
    const { commits, base, reason } = commitsForUpdate(repoRoot, u, remote);
    for (const c of commits) commitSet.add(c);
    reasons.push({ ref: u.remoteRef, kind: u.kind, isTag: u.isTag, base, reason, count: commits.length });
  }

  return {
    updates,
    commits: [...commitSet],
    tags,
    deletes,
    reasons,
  };
}

module.exports = {
  UPDATE_KIND,
  ZERO,
  SHA_RE,
  parsePrePushStdin,
  commitsForUpdate,
  computePushScope,
  remoteTips,
  revList,
};
