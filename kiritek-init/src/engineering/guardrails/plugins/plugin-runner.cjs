"use strict";

/**
 * Proceso de un plugin, bajo el modelo de permisos de Node:
 *   node <flags> plugin-runner.cjs <entry> collect <collectorId>   (ctx en KIRITEK_PLUGIN_CTX)
 *   node <flags> plugin-runner.cjs <entry> evaluate <controlId>    (PracticeInput por stdin)
 *
 * - `.cjs` y cargador propio: el código del plugin se lee y compila desde su
 *   directorio verificado; sólo puede requerir módulos builtin de Node y
 *   archivos relativos del propio plugin (sin node_modules ni resolución
 *   externa, que además el sandbox no permite).
 * - Guard de red inline (el modelo de permisos no restringe red): toda
 *   conexión TCP/TLS/HTTP/fetch/DNS/UDP se rechaza salvo a los hosts de
 *   KIRITEK_PLUGIN_NET_ALLOW; los métodos parcheados no son reescribibles.
 * - stdout propio del plugin se desvía a stderr (no se persiste); la
 *   respuesta JSON es lo único en stdout.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

// --- guard de red -------------------------------------------------------------
const allow = new Set(String(process.env.KIRITEK_PLUGIN_NET_ALLOW || "").split(",").filter(Boolean).map((h) => h.toLowerCase()));
delete process.env.KIRITEK_PLUGIN_NET_ALLOW;
const denied = (host) => Object.assign(new Error(`red no permitida para el plugin: ${host || "?"}`), { code: "ERR_PLUGIN_NETWORK_DENIED" });
const lock = (obj, key, fn) => Object.defineProperty(obj, key, { value: fn, writable: false, configurable: false, enumerable: false });
const net = require("node:net");
const connect = net.Socket.prototype.connect;
lock(net.Socket.prototype, "connect", function guardedConnect(...args) {
  const opts = args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) ? args[0] : { port: args[0], host: args[1] };
  const host = opts.path ? "ipc" : String(opts.host || "localhost").toLowerCase();
  if (opts.path || !allow.has(host)) {
    const err = denied(host);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return connect.apply(this, args);
});
const dns = require("node:dns");
for (const m of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"]) {
  const orig = dns[m];
  lock(dns, m, function guardedDns(host, ...rest) {
    if (!allow.has(String(host).toLowerCase())) {
      const cb = rest.find((x) => typeof x === "function");
      if (cb) return process.nextTick(() => cb(denied(host)));
      throw denied(host);
    }
    return orig.call(this, host, ...rest);
  });
}
lock(require("node:dgram"), "createSocket", () => {
  throw denied("udp");
});

// --- salida ----------------------------------------------------------------------
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => process.stderr.write(...args);
for (const m of ["log", "info", "warn", "error", "debug"]) console[m] = () => {};
const reply = (obj) => {
  realWrite(JSON.stringify(obj));
  process.exit(0);
};

// --- cargador del plugin -----------------------------------------------------------
function makeLoader(rootDir) {
  const cache = new Map();
  const load = (abs) => {
    if (cache.has(abs)) return cache.get(abs).exports;
    const rel = path.relative(rootDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw Object.assign(new Error("fuera del plugin"), { code: "PLUGIN_REQUIRE_DENIED" });
    const mod = { exports: {} };
    cache.set(abs, mod);
    const src = fs.readFileSync(abs, "utf8");
    if (abs.endsWith(".json")) {
      mod.exports = JSON.parse(src);
      return mod.exports;
    }
    const fn = vm.runInThisContext(Module.wrap(src), { filename: abs });
    fn.call(mod.exports, mod.exports, requireFrom(path.dirname(abs)), mod, abs, path.dirname(abs));
    return mod.exports;
  };
  const requireFrom = (dir) => (spec) => {
    const bare = String(spec).replace(/^node:/, "");
    if (Module.isBuiltin ? Module.isBuiltin(spec) : Module.builtinModules.includes(bare)) return require(spec);
    if (!spec.startsWith("./") && !spec.startsWith("../")) throw Object.assign(new Error(`módulo no permitido: ${spec}`), { code: "PLUGIN_REQUIRE_DENIED" });
    const base = path.resolve(dir, spec);
    for (const cand of [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")]) {
      try {
        if (fs.statSync(cand).isFile()) return load(cand);
      } catch (_) {
        /* siguiente candidato */
      }
    }
    throw Object.assign(new Error(`no encontrado: ${spec}`), { code: "PLUGIN_REQUIRE_DENIED" });
  };
  return load;
}

(async () => {
  const [entry, op, id] = process.argv.slice(2);
  let mod;
  try {
    mod = makeLoader(path.dirname(entry))(entry);
  } catch (_) {
    return reply({ ok: false, code: "PLUGIN_LOAD_FAILED" });
  }
  try {
    if (op === "collect") {
      const c = mod.collectors && mod.collectors[id];
      if (!c || typeof c.collect !== "function") return reply({ ok: false, code: "PLUGIN_COLLECTOR_MISSING" });
      const ctx = JSON.parse(process.env.KIRITEK_PLUGIN_CTX || "{}");
      delete process.env.KIRITEK_PLUGIN_CTX;
      return reply({ ok: true, observations: await c.collect(ctx) });
    }
    if (op === "evaluate") {
      const e = mod.evaluators && mod.evaluators[id];
      if (!e || typeof e.evaluate !== "function") return reply({ ok: false, code: "PLUGIN_EVALUATOR_MISSING" });
      const result = e.evaluate(JSON.parse(fs.readFileSync(0, "utf8")));
      if (result && typeof result.then === "function") return reply({ ok: false, code: "EVALUATOR_NOT_PURE" });
      return reply({ ok: true, result });
    }
    return reply({ ok: false, code: "PLUGIN_OP_UNKNOWN" });
  } catch (err) {
    const code = err && err.code === "ERR_ACCESS_DENIED" ? "PLUGIN_PERMISSION_DENIED" : err && err.code === "ERR_PLUGIN_NETWORK_DENIED" ? "PLUGIN_NETWORK_DENIED" : "PLUGIN_THREW";
    return reply({ ok: false, code });
  }
})();
