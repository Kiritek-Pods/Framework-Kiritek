"use strict";

// Adapter de referencia de ui.accessible-dialogs (escape-always): Escape cierra incluso lo no descartable
const OPTS = {"escapeAlways":true};

exports.createDialogUnderTest = ({ dialog }) => {
  
  const controls = ["first", "second", "close"];
  const blocking = dialog.kind !== "menu";
  let open = false;
  let focus = "trigger";
  const close = () => {
    open = false;
    focus = OPTS.noFocusReturn ? "body" : "trigger";
  };
  const move = (step) => {
    const i = controls.indexOf(focus.replace("control:", ""));
    const next = i + step;
    if (next < 0 || next >= controls.length) {
      if (blocking && !OPTS.noTrap) focus = `control:${controls[(next + controls.length) % controls.length]}`;
      else if (dialog.kind === "menu") close();
      else focus = "background:header";
    } else focus = `control:${controls[next]}`;
  };
  return {
    open() {
      open = true;
      focus = OPTS.noFocusIn ? "trigger" : "control:first";
    },
    press(key) {
      if (!open) return;
      if (key === "Escape") {
        if (OPTS.noEscape) return;
        if (dialog.dismissible || dialog.kind === "menu" || OPTS.escapeAlways) close();
      } else if (key === "Tab") move(1);
      else if (key === "Shift+Tab") move(-1);
    },
    clickOutside() {
      if (!open) return;
      if (dialog.dismissible || dialog.kind === "menu" || OPTS.outsideAlways) close();
    },
    view: () => ({
      open,
      role: OPTS.wrongRole ? "region" : dialog.kind === "menu" ? "menu" : "dialog",
      modal: dialog.kind === "modal" && !OPTS.wrongRole,
      labelled: !OPTS.unlabelled,
      focus,
      controls: controls.map((c) => c),
      backgroundInert: open && blocking && !OPTS.liveBackground,
    }),
  };
};
