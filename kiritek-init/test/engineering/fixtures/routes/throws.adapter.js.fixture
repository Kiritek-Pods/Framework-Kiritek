"use strict";

// Adapter de referencia de nav.broken-routes (throws): no se puede crear
const OPTS = {"throws":true};

exports.createRouterUnderTest = ({ session, routes }) => {
  throw new Error("router no disponible");
  const matchers = routes.map((r) => ({ ...r, re: new RegExp("^" + r.path.replace(/:[a-zA-Z][a-zA-Z0-9]*/g, "[^/]+") + "$") }));
  let current = { status: "ok", route: "/", url: "/", exitLink: false };
  let returnTo = null;
  const open = (url) => {
    const [pathname] = url.split("?");
    let decoded = pathname;
    if (!OPTS.crashOnMalformed) {
      try {
        decoded = decodeURIComponent(pathname);
      } catch (_) {
        current = { status: "not-found", route: null, url, exitLink: true };
        return;
      }
    } else decoded = decodeURIComponent(pathname);
    const m = matchers.find((r) => r.re.test(decoded));
    if (!m) {
      current = OPTS.blankNotFound ? null : { status: "not-found", route: null, url, exitLink: !OPTS.noExitLink };
      return;
    }
    if (m.auth && !session.authenticated()) {
      if (OPTS.noAuthRedirect) {
        current = { status: "error", route: null, url, exitLink: false };
        return;
      }
      returnTo = OPTS.forgetReturn ? null : OPTS.dropQuery ? pathname : url;
      current = { status: "login", route: "/login", url: "/login", exitLink: false };
      return;
    }
    current = { status: "ok", route: m.path, url, exitLink: false };
  };
  return {
    async navigate(url) {
      open(url);
    },
    async login() {
      const target = returnTo || "/";
      returnTo = null;
      if (target === "/") current = { status: "ok", route: "/", url: "/", exitLink: false };
      else open(target);
    },
    view: () => (current ? { ...current } : null),
  };
};
