"use strict";

/** Escenarios de `db.compatible-migrations` (T46.2). */

const requiredScenarios = (facts) => ["scan", facts.exceptions.length && "exceptions"].filter(Boolean);

function expectationsFor(id) {
  return {
    scan: [{ readable: true, dropColumn: 0, rename: 0, dropTable: 0, typeChange: 0, notNull: 0, blockingIndex: 0 }],
    exceptions: [{ unbacked: 0 }],
  }[id] || [];
}

const RULES = {
  readable: "migrations-unreadable",
  dropColumn: "drop-column",
  rename: "rename",
  dropTable: "drop-table",
  typeChange: "type-change",
  notNull: "not-null-without-default",
  blockingIndex: "blocking-index",
  unbacked: "contract-without-expand",
};
const ruleFor = (id, fact) => RULES[fact] || "migrations-unreadable";

module.exports = { requiredScenarios, expectationsFor, ruleFor };
