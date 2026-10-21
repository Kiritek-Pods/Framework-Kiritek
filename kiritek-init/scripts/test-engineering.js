#!/usr/bin/env node
"use strict";

/**
 * Corre sólo la suite engineering (T16.8): lista los `*.test.js` bajo
 * test/engineering y los pasa explícitos a `node --test` (Node 18–22 no
 * expanden globs de forma uniforme). Exit = exit de node --test.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(d, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.name.endsWith(".test.js")) files.push(path.relative(root, abs));
  }
};
walk(path.join(root, "test", "engineering"));
const res = spawnSync(process.execPath, ["--require", "./test/setup.js", "--test", ...files], { cwd: root, stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);
