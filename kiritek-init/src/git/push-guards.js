"use strict";

/**
 * Guardas Git del hook pre-push: push directo a la rama default y push no
 * fast-forward (force).
 *
 * A diferencia de los adaptadores de asistentes (que ven el texto del comando,
 * `git push --force ...`), el pre-push sólo recibe las líneas de refs. Por eso
 * se deducen los hechos de esas líneas:
 *  - directo a default: `remote_ref` es `refs/heads/<default>` y es una
 *    actualización o un borrado. CREAR la rama default (primer push de un repo
 *    nuevo) se permite: no hay nada que proteger todavía.
 *  - force: el `remote_sha` no es ancestro del `local_sha`. Si el commit remoto
 *    no existe localmente no se puede probar fast-forward → se trata como force.
 *
 * Límite honesto: el hook no distingue `--force` de `--force-with-lease`; con
 * `forcePolicy: "lease-only"` un push no fast-forward sólo advierte.
 *
 * (Requisitos 7.1–7.3, 8.*, G.5.)
 */

const { spawnSync } = require("child_process");

const result = require("../domain/result.js");
const { parsePrePushStdin } = require("./push-scope.js");
const { resolveDefaultBranch } = require("./default-branch.js");

const CONTROL_ID = "git.push";

function isAncestor(repoRoot, ancestor, descendant) {
  const res = spawnSync("git", ["-C", repoRoot, "merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8",
  });
  return res.status === 0;
}

function finding(ruleId, ref, remediation) {
  return result.createFinding({
    ruleId,
    path: ref,
    severity: result.SEVERITY.HIGH,
    fingerprint: `${ref}:${ruleId}`,
    remediation,
  });
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.stdin          Líneas del pre-push.
 * @param {string} opts.mode           "warning" | "enforce"
 * @param {object} [opts.config]       Config efectiva (git.*, defaultBranch.*).
 * @param {string} [opts.remote]
 * @param {(repoRoot, a, b) => boolean} [opts.isAncestor]  Inyectable.
 * @returns {object} PolicyResult
 */
function evaluatePushGuards(opts) {
  const config = opts.config || {};
  const gitCfg = config.git || {};
  const blockDirect = gitCfg.blockDirectDefaultPush !== false;
  const forcePolicy = gitCfg.forcePolicy || "deny";
  const ancestor = opts.isAncestor || isAncestor;
  const blocking = opts.mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;

  const updates = parsePrePushStdin(opts.stdin);

  let defaultBranch = null;
  if (blockDirect) {
    try {
      defaultBranch = resolveDefaultBranch({
        repoRoot: opts.repoRoot,
        remote: opts.remote || (config.defaultBranch && config.defaultBranch.remote) || "origin",
        explicit: config.defaultBranch && config.defaultBranch.explicit,
      }).branch;
    } catch (_) {
      defaultBranch = null;
    }
  }

  const denied = [];
  const warned = [];
  for (const u of updates) {
    if (u.isTag) continue;
    if (blockDirect && defaultBranch && u.remoteRef === `refs/heads/${defaultBranch}` && u.kind !== "create") {
      denied.push(
        finding(
          u.kind === "delete" ? "delete-default-branch" : "direct-push-default",
          u.remoteRef,
          "No hagas push directo a la rama default: sube una rama y abre un pull request."
        )
      );
    }
    if (u.kind === "update" && forcePolicy !== "allow" && !ancestor(opts.repoRoot, u.remoteSha, u.localSha)) {
      const f = finding(
        "force-push",
        u.remoteRef,
        "El push reescribe historial remoto (no fast-forward). Integra los cambios remotos (pull/rebase) en vez de forzar."
      );
      if (forcePolicy === "lease-only") warned.push(f);
      else denied.push(f);
    }
  }

  const reasons = [];
  if (blockDirect && !defaultBranch) {
    reasons.push("rama default no resuelta: fija defaultBranch.explicit o corre `git remote set-head origin -a`");
  }

  if (denied.length > 0) {
    return result.createResult({
      controlId: CONTROL_ID,
      decision: blocking,
      findings: denied.concat(warned),
      reason: "push directo a la rama default o reescritura de historial remoto",
      remediation: "Usa un pull request; para emergencias, el flujo break-glass autorizado.",
      scope: "push",
    });
  }
  if (warned.length > 0 || reasons.length > 0) {
    return result.createResult({
      controlId: CONTROL_ID,
      decision: result.DECISION.WARN,
      findings: warned.length ? warned : undefined,
      reason: warned.length ? "push no fast-forward (forcePolicy lease-only: no verificable desde el hook)" : reasons.join("; "),
      scope: "push",
    });
  }
  return result.createResult({ controlId: CONTROL_ID, decision: result.DECISION.ALLOW, scope: "push" });
}

module.exports = { CONTROL_ID, evaluatePushGuards };
