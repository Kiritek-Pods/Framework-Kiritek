"use strict";

/**
 * Guardas de comandos Git peligrosos.
 *
 * Evalúa un comando Git propuesto (por un adaptador o un hook de comando) y
 * decide si debe bloquearse:
 *  - push directo a la rama default,
 *  - force push peligroso (`--force`, `-f`, `+refspec`),
 *  - bypass de hooks (`--no-verify`).
 *
 * `--force-with-lease` se evalúa según política (deny/lease-only/allow), nunca
 * se asume siempre seguro. El break-glass es un flujo separado y explícito; no
 * se implementa jamás como `--no-verify`.
 *
 * El análisis es puro: recibe argumentos ya tokenizados (sin shell).
 *
 * (Requisitos 7.1–7.6, 8, 20.2, G.5.)
 */

const result = require("../domain/result.js");

const CONTROL_ID = "git.command-guard";

/** ¿El comando es un git push? */
function isPush(args) {
  return args[0] === "push";
}

/** Extrae refspecs (tokens que no son flags) tras `push [remote]`. */
function pushRefspecs(args) {
  // push [opts] [remote] [refspec...]
  const positional = args.slice(1).filter((a) => !a.startsWith("-"));
  // El primer positional suele ser el remoto.
  return positional.slice(1);
}

function hasForce(args) {
  return args.some((a) => a === "--force" || a === "-f");
}
function hasForceWithLease(args) {
  return args.some((a) => a === "--force-with-lease" || a.startsWith("--force-with-lease="));
}
function hasNoVerify(args) {
  return args.some((a) => a === "--no-verify");
}
function hasPlusRefspec(args) {
  return pushRefspecs(args).some((r) => r.startsWith("+"));
}

/**
 * ¿Alguna refspec empuja a la rama default?
 */
function pushesToDefault(args, defaultBranch) {
  if (!defaultBranch) return false;
  const refspecs = pushRefspecs(args);
  if (refspecs.length === 0) {
    // `git push` sin refspec empuja la rama actual a su upstream; el llamador
    // puede pasar `currentBranch` para decidir. Conservador: no afirmamos.
    return false;
  }
  return refspecs.some((r) => {
    const stripped = r.replace(/^\+/, "");
    const dst = stripped.includes(":") ? stripped.split(":")[1] : stripped;
    const name = dst.replace(/^refs\/heads\//, "");
    return name === defaultBranch;
  });
}

/**
 * Evalúa un comando Git.
 *
 * @param {object} input
 * @param {string[]} input.args          Argumentos de git (sin "git").
 * @param {string} input.mode            warning|enforce
 * @param {string|null} input.defaultBranch
 * @param {string} [input.forcePolicy]   deny|lease-only|allow
 * @param {boolean} [input.breakGlass]   Flujo autorizado y explícito.
 * @returns {object} PolicyResult
 */
function evaluateGitCommand(input) {
  const args = input.args || [];
  const mode = input.mode === "enforce" ? "enforce" : "warning";
  const forcePolicy = input.forcePolicy || "deny";
  const violations = [];

  if (hasNoVerify(args)) {
    violations.push({ rule: "no-verify", msg: "--no-verify no está permitido (bypass de hooks)" });
  }

  if (isPush(args)) {
    if (pushesToDefault(args, input.defaultBranch)) {
      violations.push({ rule: "direct-default-push", msg: `push directo a la rama default (${input.defaultBranch}); usa un pull request` });
    }
    const forceish = hasForce(args) || hasPlusRefspec(args);
    if (forceish) {
      violations.push({ rule: "force-push", msg: "force push peligroso (--force/-f/+refspec)" });
    } else if (hasForceWithLease(args)) {
      if (forcePolicy === "deny") {
        violations.push({ rule: "force-with-lease", msg: "--force-with-lease bloqueado por política (forcePolicy=deny)" });
      }
      // lease-only / allow: permitido.
    }
  }

  // Break-glass autorizado levanta los bloqueos de push peligroso/directo, pero
  // NUNCA el de --no-verify.
  const effective = input.breakGlass
    ? violations.filter((v) => v.rule === "no-verify")
    : violations;

  if (effective.length === 0) {
    return result.createResult({
      controlId: CONTROL_ID,
      decision: result.DECISION.ALLOW,
      toolStatus: result.TOOL_STATUS.NOT_APPLICABLE,
    });
  }

  const decision = mode === "enforce" ? result.DECISION.DENY : result.DECISION.WARN;
  return result.createResult({
    controlId: CONTROL_ID,
    decision,
    toolStatus: result.TOOL_STATUS.OK,
    reason: effective.map((v) => v.msg).join("; "),
    remediation: "Usa un pull request; para operaciones excepcionales usa el flujo break-glass autorizado, nunca --no-verify.",
  });
}

module.exports = {
  CONTROL_ID,
  isPush,
  pushRefspecs,
  hasForce,
  hasForceWithLease,
  hasNoVerify,
  pushesToDefault,
  evaluateGitCommand,
};
