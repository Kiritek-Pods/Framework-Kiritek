"use strict";
// No determinista: decide al azar si busca (simula timers/reloj no controlados).
const crypto = require("crypto");
exports.createSearchUnderTest = ({ transport, onResults }) => ({
  type(q) {
    if (crypto.randomInt(2) === 0) transport.search(q).then((r) => onResults(q, r), () => {});
  },
});
