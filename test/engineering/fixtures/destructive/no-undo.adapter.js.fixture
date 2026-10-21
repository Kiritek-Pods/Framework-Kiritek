"use strict";

// Adapter de referencia de ui.destructive-actions (no-undo): deshacer no funciona
const OPTS = {"noUndo":true};

exports.createActionUnderTest = ({ clock, transport, action }) => {
  
  const confirmFirst = action.safeguard !== "undo" && !OPTS.noConfirm;
  const withUndo = action.safeguard !== "confirm";
  const windowMs = action.undoWindowMs === undefined ? 5000 : action.undoWindowMs;
  let dialog = false;
  let status = "idle";
  let message = null;
  let timer = null;
  let busy = false;
  const run = async () => {
    if (busy && !OPTS.doubleRun) return;
    busy = true;
    status = "pending";
    try {
      await transport.execute({ action: action.id });
      status = OPTS.silentFailure ? "done" : "done";
      message = OPTS.rawKeys ? "actions.done" : "Listo.";
    } catch (_) {
      status = OPTS.silentFailure ? "done" : "error";
      message = OPTS.rawKeys ? "actions.error" : "No se pudo completar la acción.";
    } finally {
      busy = false;
    }
  };
  const schedule = () => {
    if (!withUndo || OPTS.noUndo) return run();
    if (timer !== null && !OPTS.doubleRun) return undefined;
    status = "pending";
    timer = clock.setTimeout(() => {
      timer = null;
      run();
    }, OPTS.undoNeverExecutes ? 10 ** 9 : windowMs);
    return undefined;
  };
  return {
    request() {
      if (confirmFirst) dialog = true;
      else schedule();
    },
    confirm() {
      if (!dialog && !OPTS.doubleRun) return;
      dialog = false;
      schedule();
    },
    dismiss() {
      dialog = false;
      if (OPTS.dismissExecutes) schedule();
      else status = "cancelled";
    },
    undo() {
      if (timer === null || OPTS.noUndo) return;
      clock.clearTimeout(timer);
      timer = null;
      status = "undone";
    },
    view: () => ({ dialog, status, message }),
  };
};
