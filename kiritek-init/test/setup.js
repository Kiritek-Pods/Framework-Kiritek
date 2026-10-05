"use strict";

// Aísla las pruebas de la red y de la cache real del usuario: ningún test
// descarga Gitleaks ni escribe en ~/.cache/kiritek. Los procesos hijos (e2e)
// heredan estas variables.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.env.KIRITEK_TOOL_CACHE) {
  process.env.KIRITEK_TOOL_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-test-tools-"));
}
process.env.KIRITEK_OFFLINE = "1";
