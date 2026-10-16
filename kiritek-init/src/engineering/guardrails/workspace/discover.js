"use strict";

/**
 * Discovery de perfiles: SÓLO sugerencias (T04.2; R2.2).
 *
 * Detecta señales de stack (manifests, dependencias, directorios de
 * plataforma, nombres de ruta) y devuelve sugerencias con confianza `low` o
 * `medium` y razones. Nunca escribe config, nunca activa perfiles ni
 * enforcement y nunca produce confianza determinista: dependencias y nombres
 * no prueban intención funcional.
 *
 * Privacidad: sólo lee manifests para extraer nombres de dependencias; no
 * persiste contenido. No sigue symlinks y tiene límites de profundidad/archivos.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createProfile } = require("../contracts/profile.js");
const { CONFIDENCE, deepFreeze } = require("../contracts/common.js");
const { firstMatch } = require("./glob.js");
const { compareIds } = require("./identity.js");

const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "dist", "build", "out", ".next", "Pods", ".dart_tool", ".gradle", ".kiritek", "coverage", "target"]);
const DEFAULT_LIMITS = Object.freeze({ maxDepth: 4, maxEntries: 5000, maxManifestBytes: 256 * 1024 });

/** dependencia (prefijo exacto o nombre) → perfil, confianza. */
const DEPENDENCY_SIGNALS = Object.freeze([
  { match: ["react-native", "expo"], profile: "mobile-app", confidence: CONFIDENCE.MEDIUM },
  { match: ["react", "react-dom", "next", "vue", "nuxt", "@angular/core", "svelte", "@sveltejs/kit", "solid-js", "vite"], profile: "web", confidence: CONFIDENCE.MEDIUM },
  { match: ["algoliasearch", "react-instantsearch", "instantsearch.js", "meilisearch", "@elastic/elasticsearch", "typesense", "fuse.js", "flexsearch", "lunr"], profile: "search", confidence: CONFIDENCE.LOW },
  { match: ["launchdarkly-js-client-sdk", "@growthbook/growthbook", "unleash-proxy-client", "@openfeature/web-sdk"], profile: "module-launch", confidence: CONFIDENCE.LOW },
  { match: ["launchdarkly-js-client-sdk", "launchdarkly-react-client-sdk", "@growthbook/growthbook", "unleash-proxy-client", "@openfeature/web-sdk", "@openfeature/server-sdk", "flagsmith"], profile: "feature-flags", confidence: CONFIDENCE.LOW },
  { match: ["@tanstack/react-query", "@tanstack/vue-query", "swr", "@apollo/client", "urql"], profile: "data-views", confidence: CONFIDENCE.LOW },
  { match: ["react-hook-form", "formik", "final-form", "react-final-form", "vee-validate", "@angular/forms"], profile: "forms", confidence: CONFIDENCE.LOW },
  { match: ["axios", "ky", "got", "ofetch", "undici", "superagent"], profile: "network-client", confidence: CONFIDENCE.LOW },
  { match: ["react-dropzone", "uppy", "@uppy/core", "filepond", "fine-uploader"], profile: "file-upload", confidence: CONFIDENCE.LOW },
  { match: ["react-window", "react-virtualized", "@tanstack/react-virtual", "react-infinite-scroll-component"], profile: "paginated-lists", confidence: CONFIDENCE.LOW },
  { match: ["@segment/analytics-next", "mixpanel-browser", "@amplitude/analytics-browser", "posthog-js", "react-ga4"], profile: "analytics", confidence: CONFIDENCE.LOW },
  { match: ["next-auth", "@auth0/auth0-react", "oidc-client-ts", "@azure/msal-browser", "firebase"], profile: "auth-session", confidence: CONFIDENCE.LOW },
  { match: ["i18next", "react-i18next", "react-intl", "@formatjs/intl", "vue-i18n", "next-intl", "@angular/localize"], profile: "localized", confidence: CONFIDENCE.LOW },
  { match: ["workbox-window", "workbox-core", "@react-native-community/netinfo", "localforage", "idb", "dexie", "redux-offline"], profile: "offline-capable", confidence: CONFIDENCE.LOW },
  { match: ["expo-camera", "expo-location", "expo-notifications", "react-native-permissions", "@capacitor/camera", "@capacitor/geolocation"], profile: "device-permissions", confidence: CONFIDENCE.LOW },
  { match: ["react-router", "react-router-dom", "vue-router", "@angular/router", "@react-navigation/native", "expo-router", "@tanstack/react-router"], profile: "routed-app", confidence: CONFIDENCE.LOW },
  { match: ["@radix-ui/react-dialog", "@headlessui/react", "react-modal", "@reach/dialog", "@mui/material", "focus-trap"], profile: "dialogs", confidence: CONFIDENCE.LOW },
  { match: ["express", "fastify", "koa", "hono", "@nestjs/core", "@hapi/hapi", "restify"], profile: "http-api", confidence: CONFIDENCE.MEDIUM },
  { match: ["pg", "mysql2", "mongoose", "mongodb", "@prisma/client", "ioredis", "redis", "kafkajs", "amqplib", "typeorm", "sequelize"], profile: "backend-service", confidence: CONFIDENCE.LOW },
]);
const PATH_SIGNALS = Object.freeze([
  { re: /(^|\/)search(\/|$)/i, profile: "search", confidence: CONFIDENCE.LOW },
  { re: /(^|\/)(announcements?|whats-new|release-notes|feature-flags?)(\/|$)/i, profile: "module-launch", confidence: CONFIDENCE.LOW },
]);

function relPosix(repoRoot, abs) {
  const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

function readManifest(abs, limits) {
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.size > limits.maxManifestBytes) return null;
    return fs.readFileSync(abs, "utf8");
  } catch (_) {
    return null;
  }
}

function packageJsonDeps(text) {
  try {
    const pkg = JSON.parse(text);
    return Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) });
  } catch (_) {
    return null;
  }
}

/** Recolecta señales crudas por directorio. */
function collectSignals(repoRoot, limits) {
  const signals = []; // { dir, profile, confidence, reason: Diagnostic }
  const diagnostics = [];
  let seen = 0;
  let truncated = false;
  const walk = (abs, depth) => {
    if (truncated) return;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (_) {
      return;
    }
    entries.sort((a, b) => compareIds(a.name, b.name));
    const dir = relPosix(repoRoot, abs);
    const names = new Set(entries.map((e) => e.name));
    for (const e of entries) {
      seen += 1;
      if (seen > limits.maxEntries) {
        truncated = true;
        return;
      }
      if (e.isSymbolicLink()) continue;
      const childAbs = path.join(abs, e.name);
      const rel = relPosix(repoRoot, childAbs);
      if (e.isFile() && e.name === "package.json") {
        const deps = packageJsonDeps(readManifest(childAbs, limits) || "");
        if (deps === null) {
          diagnostics.push({ code: "DISCOVERY_MANIFEST_UNREADABLE", message: `${rel}: manifest no legible; se omite` });
        } else {
          for (const sig of DEPENDENCY_SIGNALS) {
            const hit = deps.filter((d) => sig.match.includes(d)).sort();
            if (hit.length) {
              signals.push({ dir, profile: sig.profile, confidence: sig.confidence, reason: { code: "DEPENDENCY_DETECTED", message: `${rel} declara ${hit.join(", ")}` } });
            }
          }
        }
      }
      if (e.isFile() && e.name === "pubspec.yaml") {
        const text = readManifest(childAbs, limits) || "";
        if (/^\s*flutter\s*:/m.test(text)) {
          signals.push({ dir, profile: "mobile-app", confidence: CONFIDENCE.MEDIUM, reason: { code: "DEPENDENCY_DETECTED", message: `${rel} declara flutter` } });
        }
      }
      if (e.isDirectory() && (e.name === "android" || e.name === "ios") && (names.has("android") && names.has("ios"))) {
        if (e.name === "ios") {
          signals.push({ dir, profile: "mobile-app", confidence: CONFIDENCE.LOW, reason: { code: "PLATFORM_DIRECTORY", message: `${dir === "." ? "" : `${dir}/`}android e ios presentes` } });
        }
      }
      if (e.isFile() && e.name === "index.html" && /(^|\/)(public|static|src)$/.test(dir)) {
        const parent = dir.split("/").slice(0, -1).join("/") || ".";
        signals.push({ dir: parent, profile: "web", confidence: CONFIDENCE.LOW, reason: { code: "WEB_ENTRYPOINT", message: `${rel} presente` } });
      }
      if (e.isDirectory()) {
        for (const sig of PATH_SIGNALS) {
          if (sig.re.test(rel)) {
            signals.push({ dir: rel, profile: sig.profile, confidence: sig.confidence, reason: { code: "PATH_NAME", message: `ruta ${rel} sugiere ${sig.profile} (sólo por nombre)` } });
          }
        }
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".") && depth < limits.maxDepth) walk(childAbs, depth + 1);
      }
    }
  };
  walk(repoRoot, 0);
  if (truncated) diagnostics.push({ code: "DISCOVERY_TRUNCATED", message: `discovery detenido tras ${limits.maxEntries} entradas; las sugerencias pueden estar incompletas` });
  return { signals, diagnostics };
}

/** Unidad declarada que posee el directorio (por owns/excludes), si la hay. */
function ownerOf(dir, units) {
  const probe = dir === "." ? "." : `${dir}/__probe__`;
  const owners = units.filter((u) => firstMatch(u.owns, probe) && !firstMatch(u.excludes, probe));
  return owners.length === 1 ? owners[0].id : null;
}

/**
 * @param {string} repoRoot
 * @param {object} opts
 * @param {object} opts.catalog         Contrato de catálogo (para versiones de perfil).
 * @param {{id, owns, excludes, profiles}[]} [opts.units]  Unidades declaradas (opcional).
 * @returns {{suggestions: object[], diagnostics: object[]}}
 */
function discoverProfiles(repoRoot, opts) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const units = opts.units || [];
  const catalog = opts.catalog;
  const { signals, diagnostics } = collectSignals(repoRoot, limits);
  const grouped = new Map();
  for (const s of signals) {
    const unitId = ownerOf(s.dir, units);
    const key = `${unitId || s.dir}|${s.profile}`;
    if (!grouped.has(key)) grouped.set(key, { root: s.dir, unitId, profile: s.profile, confidence: s.confidence, reasons: [] });
    const g = grouped.get(key);
    if (s.confidence === CONFIDENCE.MEDIUM) g.confidence = CONFIDENCE.MEDIUM;
    if (!g.reasons.some((r) => r.message === s.reason.message)) g.reasons.push(s.reason);
  }
  const suggestions = [];
  for (const g of grouped.values()) {
    const def = catalog.profiles.find((p) => p.id === g.profile);
    if (!def) continue;
    const unit = units.find((u) => u.id === g.unitId);
    const alreadyDeclared = !!unit && unit.profiles.some((p) => p.id === g.profile);
    const profile = createProfile({
      id: def.id,
      version: def.version,
      catalog: { id: catalog.id, version: catalog.version, digest: catalog.digest },
      extends: def.extends,
      parameters: {},
      source: "suggested",
      provenance: { sourceKind: "discovery", sourceRef: g.root === "." ? "discovery:." : `discovery:${g.root.replace(/[^A-Za-z0-9._\-/]/g, "_")}` },
    });
    suggestions.push({
      root: g.root,
      unitId: g.unitId,
      profile: { id: profile.id, version: profile.version, source: profile.source },
      confidence: g.confidence,
      reasons: g.reasons.sort((a, b) => compareIds(a.message, b.message)),
      alreadyDeclared,
      requiresAcceptance: !alreadyDeclared,
    });
  }
  suggestions.sort((a, b) => compareIds(`${a.root}|${a.profile.id}`, `${b.root}|${b.profile.id}`));
  return deepFreeze({ suggestions, diagnostics });
}

module.exports = { DEPENDENCY_SIGNALS, discoverProfiles };
