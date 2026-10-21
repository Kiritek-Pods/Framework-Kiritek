"use strict";

// Adapter de referencia de svc.metrics (no-histogram): sin histograma de latencia
// GET /users/:id con contador http_requests_total y histograma http_request_duration_seconds (estilo prom-client).
const OPTS = {"noHistogram":true};
const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5];

exports.createServiceUnderTest = ({ clock, deps }) => {
  
  const counters = new Map();
  const hist = new Map();
  const key = (labels) => JSON.stringify(labels);
  const fmt = (labels) => Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
  const observe = (labels, seconds) => {
    counters.set(key(labels), (counters.get(key(labels)) || 0) + 1);
    if (OPTS.noHistogram) return;
    const h = { route: labels.route, method: labels.method };
    const cur = hist.get(key(h)) || { labels: h, buckets: BUCKETS.map(() => 0), count: 0, sum: 0 };
    BUCKETS.forEach((b, i) => (seconds <= b ? (cur.buckets[i] += 1) : null));
    cur.count += 1;
    cur.sum += seconds;
    hist.set(key(h), cur);
  };
  const exposition = () => {
    const out = ["# HELP http_requests_total Requests HTTP.", "# TYPE http_requests_total counter"];
    for (const [k, v] of counters) out.push(`http_requests_total{${fmt(JSON.parse(k))}} ${v}`);
    if (!OPTS.noHistogram) {
      out.push("# TYPE http_request_duration_seconds histogram");
      for (const h of hist.values()) {
        BUCKETS.forEach((b, i) => out.push(`http_request_duration_seconds_bucket{${fmt({ ...h.labels, le: String(b) })}} ${h.buckets[i]}`));
        out.push(`http_request_duration_seconds_bucket{${fmt({ ...h.labels, le: "+Inf" })}} ${h.count}`);
        out.push(`http_request_duration_seconds_count{${fmt(h.labels)}} ${h.count}`);
        out.push(`http_request_duration_seconds_sum{${fmt(h.labels)}} ${h.sum}`);
      }
    }
    return out.join("\n") + "\n";
  };
  const now = () => (OPTS.wallClock ? Date.now() : clock.now());
  return {
    async handle(req) {
      if (req.method === "GET" && req.path === "/metrics") return OPTS.noMetrics ? { status: 404, body: { code: "not_found" } } : { status: 200, headers: { "content-type": "text/plain; version=0.0.4" }, body: exposition() };
      const m = /^\/users\/([^/]+)$/.exec(req.path);
      if (!m) return { status: 404, body: { code: "not_found" } };
      const start = now();
      let status = 200;
      try {
        await deps.dependency();
      } catch (_) {
        status = 503;
      }
      const labels = { route: OPTS.rawPath ? req.path : "/users/:id", method: req.method, status: String(OPTS.alwaysOk ? 200 : status) };
      if (OPTS.userLabel) labels.user = String(req.headers["x-user-email"] || "");
      if (!(OPTS.skipErrors && status >= 500)) observe(labels, (now() - start) / 1000);
      return status === 200 ? { status, body: { id: m[1] } } : { status, body: { code: "unavailable" } };
    },
  };
};
