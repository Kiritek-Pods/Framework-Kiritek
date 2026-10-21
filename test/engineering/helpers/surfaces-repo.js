"use strict";

// Repo Git con los tres controles builtin configurados en warn (T14/T15) y
// un runner del CLI en proceso.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cli = require("../../../src/engineering/guardrails/cli.js");

const FIX = path.join(__dirname, "..", "fixtures");
const CONFIG = "kiritek-engineering.config.json";
const NOW = "2026-10-05T12:00:00.000Z";
const BUDGET = { agent: 1500, "pre-commit": 5000, pr: 600000, release: 900000 };

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function write(repo, rel, content) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), content);
}
const readFix = (dir, name) => fs.readFileSync(path.join(FIX, dir, `${name}.js.fixture`));

const manifest = {
  schemaVersion: 1,
  control: "web.module-announcement",
  modules: [{ moduleId: "reports", announcementRequired: true, announcementId: "ann-reports" }],
  announcements: [
    {
      id: "ann-reports",
      version: 1,
      window: { start: "2026-09-01T00:00:00Z", end: "2026-12-01T00:00:00Z" },
      owner: "team-reports",
      audiences: [{ id: "admins", criteria: [{ attribute: "role", operator: "in", values: ["admin"] }], channels: ["in-app"] }],
      channels: ["in-app"],
      content: { titleRef: "reports.title", bodyRef: "reports.body", locales: ["en", "es"], defaultLocale: "en", missingContent: "generic-text" },
      showOnce: { key: "ann-reports-v1", audienceScope: "user", periodDays: 30, storageUnavailable: "once-per-session" },
      rollout: { state: "active", history: [{ state: "active", at: "2026-09-01T00:00:00Z", by: "team-reports", reason: "lanzamiento" }] },
      presentation: { animated: true },
    },
  ],
  harness: { kind: "node-adapter", adapter: "apps/web/announce.adapter.js" },
};
const versionContract = {
  schemaVersion: 1,
  control: "app.minimum-supported-version",
  versionScheme: "semver",
  environments: { production: { source: { kind: "remote-config", authenticity: "signature", keyId: "policy-k1" }, cacheTtlSeconds: 21600, staleIfOfflineSeconds: 86400, timeoutMs: 3000 } },
  offline: { firstRun: "allow-with-warning", expiredCache: "allow-with-warning" },
  grace: { allowed: true, timeSource: "server", maxDays: 14, audience: "all" },
  hard: { explainReason: true, exitWhenStoreUnavailable: "fallback-link" },
  soft: { allowContinue: true, postponeFrequencyHours: 24 },
  stores: [
    { platform: "ios", store: "app-store", fallback: "web-download" },
    { platform: "android", store: "play-store", fallback: "web-download" },
  ],
  rollback: { mechanism: "remote-policy-revert", requiresAppRelease: false },
  override: { authenticated: true, scopedBy: ["environment", "audience"], maxDurationHours: 24, audited: true, reversible: true },
  observability: { events: ["fetch", "parse", "cache", "decision", "store", "override"], identifiers: "pseudonymous" },
  harness: { kind: "node-adapter", adapter: "apps/mobile/gate.adapter.js" },
};
const config = {
  schemaVersion: 1,
  pack: { id: "engineering/guardrails", catalog: "1.0.0" },
  workspace: {
    units: [
      {
        id: "acme/web",
        root: "apps/web",
        kind: "application",
        profiles: ["web", "search", "module-launch"].map((id) => ({ id, version: "1.0.0" })),
        owns: ["apps/web/**"],
        controls: {
          "search.input-rate": { level: "warn", parameters: { behaviorContract: "apps/web/search.contract.json" } },
          "web.module-announcement": { level: "warn", parameters: { launchManifest: "apps/web/launch.json" } },
        },
      },
      {
        id: "acme/mobile",
        root: "apps/mobile",
        kind: "application",
        profiles: [{ id: "mobile-app", version: "1.0.0" }],
        owns: ["apps/mobile/**"],
        controls: { "app.minimum-supported-version": { level: "warn", parameters: { policyContract: "apps/mobile/version-policy.json" } } },
      },
    ],
  },
};

/** Repo con los tres controles configurados; devuelve { repo, base, head }. */
function makeRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-eng-surf-")));
  git(repo, "init", "-q");
  write(repo, CONFIG, JSON.stringify(config, null, 2));
  write(repo, ".gitignore", ".kiritek/\n");
  write(repo, "apps/web/search.adapter.js", readFix("search", "good-debounce.adapter"));
  write(repo, "apps/web/search.contract.json", JSON.stringify({ schemaVersion: 1, control: "search.input-rate", triggers: "remote", cancellation: "supported", equivalence: "trim-lowercase", harness: { kind: "node-adapter", adapter: "apps/web/search.adapter.js" } }));
  write(repo, "apps/web/good.adapter.js", readFix("announcement", "good.adapter"));
  write(repo, "apps/web/announce.adapter.js", readFix("announcement", "good.adapter"));
  write(repo, "apps/web/launch.json", JSON.stringify(manifest));
  write(repo, "apps/mobile/good.adapter.js", readFix("version", "good.adapter"));
  write(repo, "apps/mobile/gate.adapter.js", readFix("version", "good.adapter"));
  write(repo, "apps/mobile/version-policy.json", JSON.stringify(versionContract));
  write(repo, "apps/web/src/app.ts", "export const app = 1;\n");
  write(repo, "apps/mobile/lib/main.dart", "void main() {}\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  write(repo, "apps/web/src/modules/reports/index.tsx", "export const Reports = () => null;\n");
  write(repo, "apps/mobile/lib/gate.dart", "// gate\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "head");
  return { repo, base, head: git(repo, "rev-parse", "HEAD") };
}

async function runCli(argv, cwd, extra = {}) {
  let out = "";
  let err = "";
  const started = Date.now();
  const code = await cli.runAsync(argv, { cwd, env: {}, stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, clock: () => NOW, ...extra });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) {
    /* no JSON */
  }
  return { code, out, err, json, elapsedMs: Date.now() - started };
}


module.exports = { CONFIG, NOW, BUDGET, git, write, makeRepo, runCli, config, manifest, versionContract };
