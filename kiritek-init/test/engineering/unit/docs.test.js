"use strict";

// T15D: la documentación existe, es consistente con el código y no promete
// lo que el pack no hace.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "..");
const DOCS = path.join(ROOT, "docs", "engineering");
const read = (rel) => fs.readFileSync(path.join(DOCS, rel), "utf8");
const catalog = require("../../../catalogs/engineering/guardrails/1.0.0/catalog.json");
const cli = require("../../../src/engineering/guardrails/cli.js");

function ruleIdsOf(controlDir) {
  const src = fs.readFileSync(path.join(ROOT, "src/engineering/guardrails/controls", controlDir, "evaluator.js"), "utf8");
  const block = (src.match(/^const (?:REMEDIATION|RULES) = (?:Object\.freeze\()?\{([\s\S]*?)\n\}\)?;/m) || [])[1] || "";
  return [...block.matchAll(/^\s+"?([a-z-]+)"?:/gm)].map((m) => m[1]);
}

test("T15D.1 cada documentationRef del catálogo existe y el paquete publica docs/", () => {
  const candidate = require("../../../release/candidates/engineering/guardrails/2.0.0/catalog.json");
  for (const c of [...catalog.controls, ...candidate.controls]) assert.ok(fs.existsSync(path.join(ROOT, c.documentationRef)), c.documentationRef);
  assert.ok(require("../../../package.json").files.includes("docs"));
  for (const f of ["README.md", "architecture.md", "configuration.md", "guides.md", "runbooks.md", "remediation.md", "compatibility.md"]) assert.ok(fs.existsSync(path.join(DOCS, f)), f);
});

test("T15D.1 los enlaces relativos de la documentación resuelven", () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".md") && files.push(path.join(d, e.name))));
  walk(DOCS);
  for (const f of files) {
    for (const [, target] of fs.readFileSync(f, "utf8").matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(f), target)), `${path.relative(DOCS, f)} → ${target}`);
    }
  }
});

test("T15D.1/T15D.4 arquitectura documenta límites y estados; remediaciones cubren todas las reglas reales", () => {
  const arch = read("architecture.md");
  for (const s of ["absent", "off", "suggested", "not_applicable", "unavailable", "unknown", "stale", "conflict", "drift", "verified"]) assert.ok(arch.includes(`\`${s}\``), s);
  assert.match(arch, /kiritek-security\.config\.json/);
  const rem = read("remediation.md");
  assert.match(rem, /heurísticas nunca bloquean/i);
  for (const dir of ["search-input-rate", "app-minimum-supported-version", "web-module-announcement", "ui-data-states", "ui-form-validation", "net-resilient-requests", "flags-lifecycle", "auth-session-expiry", "ui-file-upload", "ui-pagination", "analytics-events", "ui-destructive-actions", "i18n-formatting", "app-offline-mode", "app-device-permissions", "nav-broken-routes", "ui-accessible-dialogs", "api-idempotency", "api-error-responses", "api-rate-limit", "api-pagination", "svc-dependency-failure", "svc-health-shutdown", "svc-log-hygiene"]) {
    for (const rule of ruleIdsOf(dir)) assert.ok(rem.includes(`\`${rule}\``), `${dir}: falta ${rule}`);
  }
  for (const h of ["behavior-evidence-missing", "policy-evidence-missing", "launch-confirmation", "states-confirmation", "forms-confirmation", "requests-confirmation", "registry-confirmation", "session-confirmation", "uploads-confirmation", "lists-confirmation", "plan-confirmation", "actions-confirmation", "i18n-confirmation", "offline-confirmation", "permissions-confirmation", "routes-confirmation", "dialogs-confirmation", "idempotency-confirmation", "errors-confirmation", "ratelimit-confirmation", "pagination-confirmation", "dependency-confirmation", "health-confirmation", "logs-confirmation"]) assert.ok(rem.includes(h), h);
});

test("T15D.2/T15D.3 guías y runbooks cubren lo pedido y sólo citan comandos reales", () => {
  const guides = read("guides.md");
  for (const h of ["Repo nuevo", "Repo existente", "Monorepo", "Offline", "CI / PR", "Agentes", "Rollout", "Rollback", "Update", "Uninstall"]) assert.match(guides, new RegExp(`^## ${h}`, "m"), h);
  const runbooks = read("runbooks.md");
  for (const h of ["Falso positivo", "Flaky test", "Herramienta no disponible", "Evidencia `stale`", "Waiver / N/A", "Hard update defectuoso", "Anuncio inaccesible"]) assert.ok(runbooks.includes(`## ${h}`), h);
  assert.ok(!/--no-verify`? (?:para|como) (?:saltar|omitir)/.test(runbooks));
  const all = ["README.md", "guides.md", "runbooks.md", "configuration.md"].map(read).join("\n");
  const used = new Set([...all.matchAll(/(?:guardrails |^|`)(install|update|migrate|scan|validate|audit|doctor|promote|catalog|uninstall|hook|feedback|telemetry)\b/gm)].map((m) => m[1]));
  for (const c of used) assert.ok(cli.COMMANDS.includes(c), c);
  for (const flag of all.matchAll(/--([a-z][a-z-]+)/g)) {
    if (["no-verify"].includes(flag[1])) continue;
    assert.ok(Object.prototype.hasOwnProperty.call(cli.KNOWN_FLAGS, flag[1]), `flag documentado inexistente: --${flag[1]}`);
  }
});
