"use strict";

// Adapter de referencia de auth.session-expiry (no-refresh): nunca renueva: todo 401 lleva al login
const OPTS = {"noRefresh":true};

exports.createSessionUnderTest = ({ transport, auth, session }) => {
  
  let screen = "app";
  let draft = null;
  let refreshing = null;
  const renew = () => {
    if (OPTS.refreshPerRequest) return auth.refresh();
    if (!refreshing) refreshing = auth.refresh().finally(() => (refreshing = null));
    return refreshing;
  };
  const toLogin = () => {
    screen = OPTS.errorScreen ? "error" : "login";
    if (OPTS.dropDraft) draft = null;
  };
  const send = (op) => transport.send({ op, token: auth.token() });
  return {
    setDraft(text) {
      draft = text;
    },
    async request(op) {
      let res = await send(op);
      if (res.status !== 401) return res;
      if (session.refresh !== "token-refresh" || OPTS.noRefresh) {
        toLogin();
        throw new Error("sesión expirada");
      }
      for (let i = 0; i < (OPTS.loop ? 5 : 1); i += 1) {
        try {
          await renew();
        } catch (_) {
          toLogin();
          throw new Error("no se pudo renovar");
        }
        res = await send(op);
        if (res.status !== 401) return res;
      }
      toLogin();
      throw new Error("sesión inválida");
    },
    view: () => ({ screen, draft }),
  };
};
