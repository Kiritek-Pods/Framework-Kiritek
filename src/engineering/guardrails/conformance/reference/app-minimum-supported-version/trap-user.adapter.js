"use strict";
// Variante con UN defecto: trapUser.
exports.createVersionGateUnderTest = require("./good.adapter.js").make({ trapUser: true });
