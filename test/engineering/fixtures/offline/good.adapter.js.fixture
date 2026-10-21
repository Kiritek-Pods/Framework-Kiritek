"use strict";

// Adapter de referencia de app.offline-mode (good): implementación correcta
const OPTS = {};
const KEY = "kiritek-offline-queue";

exports.createOfflineAppUnderTest = ({ clock, network, transport, storage, actions }) => {
  
  const load = () => {
    if (OPTS.memoryOnly) return [];
    try {
      return JSON.parse(storage.getItem(KEY) || "[]");
    } catch (_) {
      return [];
    }
  };
  let queue = load();
  let mem = OPTS.memoryOnly ? [] : null;
  const save = () => (OPTS.memoryOnly ? (mem = queue) : storage.setItem(KEY, JSON.stringify(queue)));
  let syncing = false;
  const sync = async () => {
    if (syncing || !network.online()) return;
    syncing = true;
    try {
      const order = OPTS.reverseOrder ? [...queue].reverse() : [...queue];
      for (const item of order) {
        try {
          await transport.send(item);
          if (!OPTS.keepAfterSync) queue = queue.filter((q) => q.uid !== item.uid);
          save();
          if (OPTS.doubleSend) await transport.send(item);
        } catch (_) {
          break;
        }
      }
    } finally {
      syncing = false;
    }
  };
  network.onChange((isOnline) => {
    if (isOnline && !OPTS.noSync) sync();
  });
  if (!OPTS.noSync) clock.setTimeout(() => sync(), 0);
  let uid = queue.length;
  return {
    async perform(actionId, payload) {
      const spec = actions.find((a) => a.id === actionId);
      const item = { action: actionId, payload, uid: ++uid };
      if (network.online()) {
        await transport.send(item);
        return { ok: true };
      }
      if (spec.queue !== "required" && !OPTS.queueEverything) {
        if (OPTS.fakeSuccess) return { ok: true };
        return { ok: false, reason: "sin conexión" };
      }
      if (OPTS.errorOffline) throw new Error("sin conexión");
      queue.push(item);
      save();
      return { ok: true, queued: true };
    },
    view: () => ({ offlineNotice: OPTS.noNotice ? false : !network.online(), pending: queue.length }),
  };
};
