#!/usr/bin/env node
"use strict";

const { run } = require("../src/cli.js");

run(process.argv.slice(2)).catch((err) => {
  console.error(`\nkiritek-init falló: ${err.message}`);
  process.exit(1);
});
