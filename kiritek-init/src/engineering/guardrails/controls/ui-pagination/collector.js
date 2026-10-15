"use strict";

/** Collector de `ui.pagination` (T24). Ver shared/behavior-collector.js. */

const path = require("node:path");
const { makeCollector } = require("../shared/behavior-collector.js");
const { scanSources } = require("../shared/static-signals.js");
const { loadListsContract } = require("./contract.js");
const { MAX_LISTS } = require("./scenarios.js");

const LIST_RE = /(useInfiniteQuery\(|fetchNextPage|loadMore|nextCursor|next_cursor|hasNextPage|\bpage(?:Size|_size)\b|\boffset=|InfiniteScroll|FlatList\b|RecyclerView\b|ListView\.builder)/;

module.exports = makeCollector({
  id: "ui-pagination/collector",
  version: "1.0.0",
  label: "listas paginadas",
  paramName: "listsContract",
  contractKind: "lists-contract",
  behaviorKind: "lists-behavior",
  runKind: "lists-harness-run",
  signalsKind: "lists-signals",
  traceSchema: "engineering/controls/ui-pagination.trace",
  harnessModule: path.join(__dirname, "harness.js"),
  factory: "createListUnderTest",
  load: loadListsContract,
  harnessParams: (facts) => ({ lists: facts.lists.slice(0, MAX_LISTS) }),
  scanSignals: (ctx) => scanSources(ctx.repoRoot, ctx.unit.root, { re: LIST_RE, signal: "PAGINATED_LIST" }),
});
