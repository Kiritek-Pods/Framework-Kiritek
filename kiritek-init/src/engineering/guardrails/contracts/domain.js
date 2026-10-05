"use strict";

/**
 * Separación de dominios security / engineering (R1.4, R1.5; G1, G5).
 *
 * - Un resultado sólo puede probar conformidad de su propio dominio: un
 *   `allow` engineering no dice nada de security y viceversa.
 * - El agregado multidominio conserva cada dominio por separado y no expone
 *   un booleano global engañoso.
 * - Un pack ausente es `not-installed`, nunca `failed`, y no altera el
 *   estado del otro dominio.
 */

const c = require("./common.js");
const { isVerifiedConformity, EVALUATION_STATE } = require("./result-envelope.js");
const { DECISION, TOOL_STATUS } = require("./policy-result.js");

const DOMAIN_STATUS = Object.freeze({
  NOT_INSTALLED: "not-installed",
  NO_RESULTS: "no-results",
  ALLOW: "allow",
  UNVERIFIED: "unverified",
  WARN: "warn",
  ERROR: "error",
  DENY: "deny",
});
const STATUS_RANK = Object.freeze({ "no-results": 0, allow: 1, unverified: 2, warn: 3, error: 4, deny: 5 });

/**
 * ¿`entry` prueba conformidad verificada del dominio `domain`?
 *
 * `entry` es `{ domain: "security", result }` (PolicyResult v1) o un
 * EngineeringResultEnvelope (`domain: "engineering"`).
 */
function provesConformity(entry, domain) {
  c.assertEnum(domain, c.DOMAINS, "domain");
  if (!entry || entry.domain !== domain) return false;
  if (domain === c.DOMAIN.ENGINEERING) return isVerifiedConformity(entry);
  const r = entry.result;
  return !!r && r.decision === DECISION.ALLOW && r.toolStatus === TOOL_STATUS.OK;
}

function worst(statuses) {
  return statuses.reduce((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), DOMAIN_STATUS.NO_RESULTS);
}

function securityEntryStatus(entry) {
  return entry.result.decision; // allow | warn | deny | error
}

function engineeringEntryStatus(envelope) {
  if (envelope.state !== EVALUATION_STATE.EVALUATED) {
    // Abstenciones/estados operativos nunca cuentan como allow.
    if (envelope.result && envelope.result.decision === DECISION.ERROR) return DOMAIN_STATUS.ERROR;
    if (envelope.result && envelope.result.decision === DECISION.WARN) return DOMAIN_STATUS.WARN;
    return DOMAIN_STATUS.UNVERIFIED;
  }
  const d = envelope.result.decision;
  if (d === DECISION.ALLOW) return isVerifiedConformity(envelope) ? DOMAIN_STATUS.ALLOW : DOMAIN_STATUS.UNVERIFIED;
  if (d === DECISION.WARN && envelope.suppressed.length > 0) return DOMAIN_STATUS.WARN;
  return d;
}

function summarize(domain, pack, entryStatus) {
  if (!pack || pack.installed !== true) {
    return { domain, installed: false, status: DOMAIN_STATUS.NOT_INSTALLED, counts: {}, entries: [] };
  }
  const entries = pack.entries || [];
  c.assertArray(entries, `${domain}.entries`);
  const counts = {};
  const summarized = entries.map((e) => {
    if (!e || e.domain !== domain) {
      c.fail(`resultado de dominio "${e && e.domain}" mezclado en ${domain}`, "DOMAIN_MISMATCH");
    }
    const status = entryStatus(e);
    counts[status] = (counts[status] || 0) + 1;
    const out = { controlId: domain === c.DOMAIN.ENGINEERING ? e.control.id : e.result.controlId, status };
    if (domain === c.DOMAIN.ENGINEERING) {
      out.unitId = e.unit.id;
      out.state = e.state;
      out.blockingEligible = e.blockingEligible;
    }
    return out;
  });
  return { domain, installed: true, status: worst(summarized.map((s) => s.status)), counts, entries: summarized };
}

/**
 * Agrega resultados por dominio sin cruzar significado.
 *
 * @param {object} input
 * @param {{installed: boolean, entries?: object[]}} [input.security]
 * @param {{installed: boolean, entries?: object[]}} [input.engineering]
 */
function aggregateDomains(input = {}) {
  c.assertObject(input, "aggregateDomains");
  c.assertKnownKeys(input, c.DOMAINS, "aggregateDomains");
  return c.deepFreeze({
    schemaVersion: 1,
    domains: {
      security: summarize(c.DOMAIN.SECURITY, input.security, securityEntryStatus),
      engineering: summarize(c.DOMAIN.ENGINEERING, input.engineering, engineeringEntryStatus),
    },
  });
}

module.exports = { DOMAIN_STATUS, provesConformity, aggregateDomains };
