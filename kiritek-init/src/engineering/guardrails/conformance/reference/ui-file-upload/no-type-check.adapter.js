"use strict";

// Adapter de referencia de ui.file-upload (no-type-check): sube cualquier tipo
const OPTS = {"noTypeCheck":true};
const matches = (accept, type) => accept.some((a) => a === "*/*" || a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));

exports.createUploadUnderTest = ({ transport, upload }) => {
  
  let file = null;
  let status = "idle";
  let progress = 0;
  let error = null;
  let current = null;
  const begin = () => {
    if (status === "uploading" && !OPTS.doubleStart) return;
    if (!OPTS.noSizeCheck && file.size > upload.maxBytes) {
      status = "rejected";
      error = OPTS.rawKeys ? "upload.errors.size" : "El archivo es demasiado grande.";
      return;
    }
    if (!OPTS.noTypeCheck && !matches(upload.accept, file.type)) {
      status = "rejected";
      error = OPTS.rawKeys ? "upload.errors.type" : "Ese tipo de archivo no está permitido.";
      return;
    }
    status = "uploading";
    progress = 0;
    error = null;
    const job = transport.upload({ file, onProgress: (p) => (OPTS.noProgress ? undefined : (progress = p)) });
    current = job;
    job.done.then(
      () => {
        if (current !== job) return;
        status = "done";
        progress = 100;
      },
      (e) => {
        if (current !== job || e.code === "ABORTED") return;
        status = OPTS.noErrorState ? "uploading" : "error";
        error = "La subida falló.";
      }
    );
  };
  return {
    select(f) {
      file = f;
      status = "selected";
    },
    start: () => begin(),
    cancel() {
      if (OPTS.noCancel || status !== "uploading") return;
      current.abort();
      status = "cancelled";
    },
    retry() {
      if (OPTS.noRetry || status !== "error") return;
      begin();
    },
    view: () => ({ status, progress, error }),
  };
};
