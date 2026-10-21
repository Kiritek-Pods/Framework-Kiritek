"use strict";
// Implementación correcta de referencia (glue del equipo) para el harness.
// Las variantes defectuosas la reutilizan cambiando UNA decisión vía `flaws`.
const TTL_MS = 21600 * 1000;
const STALE_MS = 86400 * 1000;
const TIMEOUT_MS = 3000;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(v) {
  const m = SEMVER.exec(v);
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] } : null;
}
function cmpSemver(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    const an = /^\d+$/.test(x.pre[i]);
    const bn = /^\d+$/.test(y.pre[i]);
    if (an && bn && Number(x.pre[i]) !== Number(y.pre[i])) return Number(x.pre[i]) - Number(y.pre[i]);
    if (an !== bn) return an ? -1 : 1;
    if (x.pre[i] !== y.pre[i]) return x.pre[i] < y.pre[i] ? -1 : 1;
  }
  return 0;
}

function make(flaws = {}) {
  const cmp = flaws.lexicographic ? (a, b) => (a < b ? -1 : a > b ? 1 : 0) : cmpSemver;
  return ({ clock, transport, cache, stores, platform, installedVersion, environment }) => {
    const fetchWithTimeout = () =>
      new Promise((resolve) => {
        const controller = new AbortController();
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          resolve(v);
        };
        if (!flaws.noTimeout) {
          clock.setTimeout(() => {
            controller.abort();
            finish(null);
          }, TIMEOUT_MS);
        }
        transport.fetchPolicy({ environment, signal: controller.signal }).then(finish, () => finish(null));
      });

    const valid = (r) => r && r.policy && (flaws.trustPayload || (r.signature === "valid" && parse(String(r.policy.minimumVersion))));

    const decide = (policy, serverTime, source) => {
      const now = flaws.localClock ? clock.now() : serverTime;
      const lifted = (policy.overrides || []).some((o) => flaws.ignoreOverrides ? false : o.authenticated && o.environment === environment && o.expiresAt > serverTime && o.effect === "lift");
      if (lifted) return { action: "none", canContinue: true, policySource: source };
      const min = String(policy.minimumVersion);
      if (parse(min) && cmp(installedVersion, min) < 0) {
        if (policy.graceUntil && now < policy.graceUntil) return { action: "soft", canContinue: true, canPostpone: true, policySource: source };
        const store = stores.resolve(platform);
        if (!store.available) {
          return flaws.trapUser
            ? { action: "hard", canContinue: false, updateTarget: "store", explanationAccessible: false, exitAvailable: false, policySource: source }
            : { action: "hard", canContinue: false, updateTarget: "fallback", explanationAccessible: true, exitAvailable: true, policySource: source };
        }
        return { action: "hard", canContinue: false, canPostpone: false, updateTarget: platform === "enterprise" ? "enterprise" : "store", explanationAccessible: true, exitAvailable: true, policySource: source };
      }
      if (policy.softMinimumVersion && cmp(installedVersion, policy.softMinimumVersion) < 0) return { action: "soft", canContinue: true, canPostpone: true, policySource: source };
      return { action: "none", canContinue: true, policySource: source };
    };

    return {
      async evaluate() {
        const now = clock.now();
        const r = await fetchWithTimeout();
        if (valid(r)) {
          cache.write({ policy: r.policy, storedAt: now, serverTime: r.serverTime });
          const d = decide(r.policy, r.serverTime, "remote");
          return flaws.extra ? { ...d, ...flaws.extra } : d;
        }
        const cached = cache.read();
        if (cached) {
          const age = now - cached.storedAt;
          const serverNow = cached.serverTime ? cached.serverTime + age : now;
          if (age <= TTL_MS) return decide(cached.policy, serverNow, "cache");
          if (age <= STALE_MS) return decide(cached.policy, serverNow, "stale-cache");
          return { action: "none", canContinue: true, policySource: "none" };
        }
        return { action: "none", canContinue: true, policySource: "none" };
      },
    };
  };
}

exports.make = make;
exports.createVersionGateUnderTest = make();
