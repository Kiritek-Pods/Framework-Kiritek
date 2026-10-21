"use strict";

/** Collector de `ui.file-upload` (T23). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadUploadsContract } = require("./contract.js");
const { MAX_UPLOADS } = require("./scenarios.js");

const UPLOAD_RE = /(type=["']file["']|FormData\(|multipart\/form-data|useDropzone\(|ImagePicker|FilePicker|UIDocumentPicker|upload\()/;

module.exports = makeCollector({
  id: "ui-file-upload/collector",
  version: "1.0.0",
  label: "subidas de archivos",
  paramName: "uploadsContract",
  contractKind: "uploads-contract",
  behaviorKind: "uploads-behavior",
  runKind: "uploads-harness-run",
  signalsKind: "uploads-signals",
  traceSchema: "engineering/controls/ui-file-upload.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createUploadUnderTest",
  load: loadUploadsContract,
  harnessParams: (facts) => ({ uploads: facts.uploads.slice(0, MAX_UPLOADS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: UPLOAD_RE, signal: "FILE_UPLOAD" }),
});
