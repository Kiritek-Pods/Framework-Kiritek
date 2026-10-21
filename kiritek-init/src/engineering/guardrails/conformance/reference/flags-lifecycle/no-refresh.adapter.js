"use strict";

// Adapter de referencia de flags.lifecycle (no-refresh): nunca refresca: el kill switch no llega
const OPTS = {"noRefresh":true};

exports.createFlagClientUnderTest = ({ clock, provider, flags, client }) => {
  
  const defaults = Object.fromEntries(flags.map((f) => [f.key, f.defaultValue]));
  let cache = {};
  let failed = false;
  const load = () =>
    new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        failed = !ok;
        resolve();
      };
      if (!OPTS.noTimeout) clock.setTimeout(() => finish(false), client.timeoutMs);
      provider.fetch().then(
        (r) => {
          cache = { ...(r && r.values) };
          finish(true);
        },
        () => finish(false)
      );
    });
  let ready = load();
  const schedule = () =>
    clock.setTimeout(() => {
      ready = load();
      schedule();
    }, client.refreshSeconds * 1000);
  if (!OPTS.noRefresh) schedule();
  return {
    async evaluate(key) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
        if (OPTS.unknownThrows) throw new Error(`flag desconocida: ${key}`);
        return false;
      }
      await ready;
      if (OPTS.ignoreProvider) return defaults[key];
      if (failed && OPTS.throwsOnDown) throw new Error("proveedor caído");
      const v = cache[key];
      if (OPTS.trustGarbage && v !== undefined) return v;
      return typeof v === typeof defaults[key] ? v : defaults[key];
    },
  };
};
