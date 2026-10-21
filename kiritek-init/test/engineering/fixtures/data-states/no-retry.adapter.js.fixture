"use strict";

// Adapter de referencia de ui.data-states (no-retry): error sin reintento
const OPTS = {"noRetry":true};

exports.createScreenUnderTest = ({ clock, transport, screen }) => {
  
  let s = { state: "loading", items: 0, retry: false, busy: true };
  let seq = 0;
  const load = () => {
    const mine = ++seq;
    s = OPTS.blankLoading ? null : { state: "loading", items: 0, retry: false, busy: !OPTS.silentLoading };
    let timer = null;
    const done = (next) => {
      if (mine !== seq) return;
      if (timer !== null) clock.clearTimeout(timer);
      s = next;
    };
    if (!OPTS.noTimeout) timer = clock.setTimeout(() => done({ state: "error", items: 0, retry: !OPTS.noRetry, busy: false }), screen.timeoutMs);
    return transport.load({ screen: screen.id }).then(
      (r) => done(r.items.length || OPTS.noEmpty ? { state: "content", items: r.items.length, retry: false, busy: false } : { state: "empty", items: 0, retry: false, busy: false }),
      () => (OPTS.noError ? undefined : done({ state: "error", items: 0, retry: !OPTS.noRetry, busy: false }))
    );
  };
  return {
    mount() {
      if (OPTS.doubleFetch) load();
      return load();
    },
    view: () => (s ? { ...s } : null),
    retry: () => (OPTS.noRetry ? undefined : load()),
  };
};
