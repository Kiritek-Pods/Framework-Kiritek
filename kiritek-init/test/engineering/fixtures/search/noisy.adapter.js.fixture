"use strict";
// Imprime las consultas: el harness debe aislar stdout y la traza no las incluye.
const base = require("./good-debounce.adapter.js");
exports.createSearchUnderTest = (deps) => {
  const sut = base.createSearchUnderTest(deps);
  return {
    type(q) {
      console.log(`consulta=${q}`);
      process.stdout.write(`raw ${q}\n`);
      sut.type(q);
    },
  };
};
