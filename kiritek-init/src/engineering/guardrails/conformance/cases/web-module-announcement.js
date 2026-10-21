"use strict";

/** Casos de conformidad R27 de `web.module-announcement` (T16.1). */

function manifestDoc(adapter, mutate = () => {}) {
  const doc = {
    schemaVersion: 1,
    control: "web.module-announcement",
    modules: [
      { moduleId: "reports", announcementRequired: true, announcementId: "ann-reports" },
      { moduleId: "internal-tools", announcementRequired: true, governedNaRef: "na-internal-tools" },
    ],
    announcements: [
      {
        id: "ann-reports",
        version: 1,
        window: { start: "2026-09-01T00:00:00Z", end: "2026-12-01T00:00:00Z" },
        owner: "team-reports",
        audiences: [{ id: "admins", criteria: [{ attribute: "role", operator: "in", values: ["admin"] }], channels: ["in-app"], fallbackChannel: "release-notes" }],
        channels: ["in-app", "release-notes"],
        content: { titleRef: "reports.title", bodyRef: "reports.body", locales: ["en", "es"], defaultLocale: "en", missingContent: "generic-text" },
        showOnce: { key: "ann-reports-v1", audienceScope: "user", periodDays: 30, storageUnavailable: "once-per-session" },
        rollout: { state: "active", history: [{ state: "active", at: "2026-09-01T00:00:00Z", by: "team-reports", reason: "lanzamiento" }] },
        presentation: { animated: true },
      },
    ],
    governedNa: [{ ref: "na-internal-tools", moduleId: "internal-tools", reason: "Uso interno", scope: "apps/x/internal", reviewBy: "2027-01-01T00:00:00Z", approval: { by: "web-leads", ref: "ADR-42" } }],
    harness: { kind: "node-adapter", adapter: `apps/x/${adapter}.adapter.js` },
  };
  mutate(doc);
  return doc;
}
const withManifest = (doc) => ({ files: { "apps/x/launch.json": typeof doc === "string" ? doc : JSON.stringify(doc) }, parameters: { launchManifest: "apps/x/launch.json" } });
const negative = (id, adapter, rules) => ({ id, kind: "negative", ...withManifest(manifestDoc(adapter)), expect: { decision: "warn", rules, eligible: true } });

module.exports = {
  control: "web.module-announcement",
  profiles: ["web", "module-launch"],
  cases: [
    { id: "anuncio-correcto", kind: "positive", ...withManifest(manifestDoc("good")), expect: { decision: "allow", rules: [], eligible: false } },
    { id: "identidades-no-salen", kind: "positive", ...withManifest(manifestDoc("leaky")), expect: { decision: "allow", rules: [], eligible: false } },
    negative("sin-show-once", "no-dedupe", ["show-once"]),
    negative("storage-rompe-modulo", "storage-crash", ["show-once"]),
    negative("retirar-anuncio-retira-modulo", "retire-hides-module", ["rollout"]),
    negative("cierre-atrapante", "trap-escape", ["close"]),
    negative("sin-teclado", "mouse-only", ["keyboard"]),
    negative("ignora-reduced-motion", "no-reduced-motion", ["reduced-motion"]),
    negative("contraste-bajo", "low-contrast", ["contrast"]),
    negative("claves-internas", "raw-keys", ["content-fallback", "localization"]),
    negative("markup-roto", "raw-markup", ["content-fallback"]),
    negative("controles-sin-nombre", "unnamed", ["name-role-state"]),
    { id: "senal-requerida-ausente", kind: "negative", ...withManifest(manifestDoc("good", (d) => d.modules.push({ moduleId: "billing", announcementRequired: true }))), expect: { decision: "warn", rules: ["required-signal-missing"], eligible: true } },
    { id: "na-vencido", kind: "negative", ...withManifest(manifestDoc("good", (d) => (d.governedNa[0].reviewBy = "2026-01-01T00:00:00Z"))), expect: { decision: "warn", rules: ["invalid-na"], eligible: true } },
    { id: "manifest-invalido", kind: "negative", ...withManifest("{ roto"), expect: { decision: "warn", rules: ["metadata-invalid"], eligible: true } },
    { id: "sin-manifest-inferencia-por-ruta", kind: "edge", files: {}, parameters: {}, paths: ["apps/x/src/modules/reports/index.tsx"], expect: { decision: "warn", eligible: false } },
    { id: "sin-harness-sin-bloqueo", kind: "edge", ...withManifest(manifestDoc("good", (d) => delete d.harness)), expect: { decision: "warn", eligible: false } },
    { id: "adapter-que-falla", kind: "edge", ...withManifest(manifestDoc("throws")), expect: { eligible: false } },
  ],
};
