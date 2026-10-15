"use strict";

// Adapter de referencia de ui.pagination (throws): no se puede montar
const OPTS = {"throws":true};

exports.createListUnderTest = ({ transport, list }) => {
  throw new Error("lista no disponible");
  let items = [];
  let cursor = null;
  let offset = 0;
  let end = false;
  let loading = false;
  let error = false;
  const load = async () => {
    if ((loading && !OPTS.concurrent) || (end && !OPTS.ignoreEnd)) return;
    loading = true;
    try {
      const useCursor = list.mode === "cursor" && !OPTS.offsetAlways;
      const req = { limit: OPTS.wrongLimit ? list.pageSize * 3 : list.pageSize, ...(useCursor ? { cursor } : { offset }) };
      const res = await transport.fetchPage(req);
      error = false;
      const page = res.items.map((x) => x.id);
      items = OPTS.dedupe === false ? items.concat(page) : items.concat(page);
      if (OPTS.reverse) items = page.concat(items.slice(0, items.length - page.length));
      cursor = page.length ? page[page.length - 1] : cursor;
      offset += page.length;
      end = OPTS.noEnd ? false : OPTS.emptyPageEnd ? page.length === 0 : !res.hasMore;
    } catch (_) {
      if (OPTS.clearOnError) items = [];
      error = !OPTS.silentError;
    } finally {
      loading = false;
    }
  };
  return {
    mount: () => load(),
    loadMore: () => load(),
    view: () => ({ items: [...items], end, loading, error }),
  };
};
