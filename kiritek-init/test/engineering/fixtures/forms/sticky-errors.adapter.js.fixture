"use strict";

// Adapter de referencia de ui.form-validation (sticky-errors): no quita el error al corregir
const OPTS = {"stickyErrors":true};
const FORMATS = { email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, number: /^-?\d+(\.\d+)?$/, url: /^https?:\/\/\S+$/, phone: /^\+?[\d\s-]{7,}$/ };

exports.createFormUnderTest = ({ form, submit }) => {
  
  const values = Object.fromEntries(form.fields.map((f) => [f.name, ""]));
  const errors = {};
  let focus = "origin";
  let status = "idle";
  let announced = false;
  const check = (f) => {
    const v = String(values[f.name] || "");
    if (!v.trim()) return f.required && !OPTS.noValidation ? (OPTS.rawKeys ? "errors.required" : "Este campo es obligatorio.") : null;
    if (OPTS.noValidation || OPTS.laxFormat) return null;
    if (FORMATS[f.format] && !FORMATS[f.format].test(v)) return "El formato no es válido.";
    if (f.format === "text" && f.minLength && v.length < f.minLength) return `Escribe al menos ${f.minLength} caracteres.`;
    if (f.format === "text" && f.maxLength && v.length > f.maxLength) return `Máximo ${f.maxLength} caracteres.`;
    return null;
  };
  return {
    fill(name, value) {
      values[name] = value;
    },
    blur(name) {
      if (OPTS.stickyErrors) return;
      const f = form.fields.find((x) => x.name === name);
      const e = check(f);
      if (e) errors[name] = e;
      else delete errors[name];
    },
    async submit() {
      if (status === "submitting" && !OPTS.doubleSubmit) return;
      for (const f of form.fields) {
        const e = check(f);
        if (e) errors[f.name] = e;
        else delete errors[f.name];
      }
      const invalid = form.fields.filter((f) => errors[f.name]);
      if (invalid.length) {
        if (!OPTS.noFocus) focus = `field:${invalid[0].name}`;
        return;
      }
      status = "submitting";
      announced = false;
      try {
        await submit({ ...values });
        status = "submitted";
      } catch (_) {
        status = "error";
        announced = !OPTS.silentError;
        if (OPTS.resetOnError) for (const k of Object.keys(values)) values[k] = "";
      }
    },
    view: () => ({
      fields: form.fields.map((f) => ({ name: f.name, value: values[f.name], invalid: !!errors[f.name], error: errors[f.name] || null, errorLinked: !!errors[f.name] && !OPTS.unlinked })),
      focus,
      status,
      announced,
    }),
  };
};
