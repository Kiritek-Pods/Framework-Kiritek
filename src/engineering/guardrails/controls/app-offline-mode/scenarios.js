"use strict";

/**
 * Escenarios de `app.offline-mode` (T28.2). La red y el almacenamiento son
 * sintéticos: el harness corta y devuelve la conexión y puede "reiniciar" la
 * app conservando el almacenamiento.
 */

const MAX_ACTIONS = 5;

function scenarioIds(facts) {
  const out = facts.indicator === "required" ? ["notice"] : [];
  for (const a of facts.actions.slice(0, MAX_ACTIONS)) {
    out.push(`online@${a.id}`);
    if (a.queue === "required") out.push(`queue@${a.id}`, `restart@${a.id}`, `order@${a.id}`);
    else out.push(`offline-reject@${a.id}`);
  }
  return out;
}

const requiredScenarios = (facts) => scenarioIds(facts);

function expectationsFor(id) {
  return {
    notice: [{ notice: true }, { notice: false }],
    online: [{ accepted: true, delivered: 1 }],
    queue: [{ accepted: true, delivered: 1, drained: true }],
    restart: [{ delivered: 1, drained: true }],
    order: [{ ordered: true, delivered: 2 }],
    "offline-reject": [{ rejectedOffline: true, delivered: 0 }],
  }[id.split("@")[0]] || [];
}

const RULES = {
  notice: { default: "offline-indicator" },
  online: { default: "online-send" },
  queue: { accepted: "offline-accept", drained: "queue-drain", default: "sync-once" },
  restart: { default: "persist-queue" },
  order: { default: "sync-order" },
  "offline-reject": { default: "online-only" },
};
function ruleFor(id, fact) {
  const r = RULES[id.split("@")[0]] || {};
  return r[fact] || r.default;
}

module.exports = { MAX_ACTIONS, scenarioIds, requiredScenarios, expectationsFor, ruleFor };
