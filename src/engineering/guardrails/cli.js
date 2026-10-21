"use strict";

/**
 * CLI del pack `engineering/guardrails` (T09.1–T09.5).
 *
 * Comandos (todos no interactivos, salida JSON estable en stdout, diagnóstico
 * humano en stderr):
 *
 *   guardrails install [--dry-run]
 *   guardrails scan      --moment=<m> [--unit] [--control] [--scope|--range|--base] ...
 *   guardrails validate [config]                 (valida la config efectiva)
 *   guardrails audit    [--unit] [--control]      (estado por pack/unidad/control)
 *   guardrails doctor                             (readiness para promover)
 *   guardrails promote  --unit=<u> --control=<c> --to=enforce
 *   guardrails catalog diff --to=<version>        (plan/diff entre catálogos)
 *   guardrails uninstall [--dry-run]
 *   guardrails hook kiro|claude --stdin-file=<f> (adaptadores de agente, T14)
 *   guardrails audit [--deep] [--format=json|text]  (capacidades reales, T15)
 *   guardrails doctor|promote                       (readiness por unidad/control, T15.4)
 *   guardrails feedback --control --rule --fingerprint --verdict  (calidad, T15A)
 *   guardrails telemetry status|flush               (telemetría opt-in, T15A)
 *
 * Principios:
 *  - Flags ALLOWLISTED: cualquier flag desconocido, o un flag que parezca
 *    credencial (token/secret/password/key/auth…), se rechaza con exit de uso
 *    (T09.2, R20).
 *  - Aislamiento de dominio: nunca lee ni escribe `kiritek-security.config.json`
 *    ni artefactos `core/security` (T09.4, R1).
 *  - Exit codes diferenciados (T09.3) — ver EXIT.
 *  - Toda salida publicada cruza la minimización/redacción del pack (T08).
 */

const { runLifecycle, uninstallWithPolicy } = require("./install/lifecycle.js");
const { resolveEngineeringConfig, provenanceReport } = require("./config/index.js");
const { createCatalogSession, resolveCatalog } = require("./catalog/resolve.js");
const { diffCatalogs } = require("./catalog/diff.js");
const { resolveUnits } = require("./workspace/units.js");
const { resolveScope } = require("./workspace/scope.js");
const { evaluateRun } = require("./orchestrator.js");
const { GuardrailsError } = require("./errors.js");
const { builtinControls, controlsFor } = require("./controls/index.js");
const { loadExceptions } = require("./exceptions/index.js");
const adapters = require("./adapters/index.js");
const { linkSurfaces, unlinkSurfaces } = require("./adapters/install.js");
const audit = require("./audit/index.js");
const telemetry = require("./telemetry/index.js");
const { writeEvidence } = require("./privacy/evidence-store.js");
const { prepareForPublication } = require("./privacy/publish.js");
const { discoverProfiles } = require("./workspace/discover.js");
const { CONFIG_FILE } = require("./config/defaults.js");
const conformance = require("./conformance/index.js");

const VERSION = require("../../../package.json").version;

/**
 * Exit codes del CLI engineering (T09.3). Separan explícitamente política,
 * configuración, herramienta/integridad, error interno y conflicto de
 * migración; nunca se mezcla un error operativo con un policy deny.
 */
const EXIT = Object.freeze({
  OK: 0, // allow / warn (feedback, nunca bloquea por warn)
  POLICY_DENY: 1, // deny elegible y vigente en enforce
  USAGE: 2, // uso incorrecto: flag desconocido/credencial, argumento faltante
  CONFIG: 3, // configuración inválida/ambigua o catálogo irresoluble
  TOOL_UNAVAILABLE: 4, // herramienta/implementación/integridad no disponible
  INTERNAL: 5, // error interno inesperado
  MIGRATION_CONFLICT: 6, // conflicto de artefactos (install/uninstall/migrate)
});

const COMMANDS = Object.freeze(["install", "update", "migrate", "scan", "validate", "audit", "doctor", "promote", "catalog", "uninstall", "hook", "feedback", "telemetry", "conformance"]);

/** Flags permitidos y su tipo. value = requiere valor; boolean = sin valor. */
const KNOWN_FLAGS = Object.freeze({
  help: "boolean",
  version: "boolean",
  "dry-run": "boolean",
  offline: "boolean",
  unit: "value",
  control: "value",
  moment: "value",
  scope: "value",
  range: "value",
  base: "value",
  revision: "value",
  catalog: "value",
  format: "value",
  to: "value",
  "agent-path": "value",
  artifact: "value",
  "stdin-file": "value",
  "warn-as": "value",
  surfaces: "value",
  deep: "boolean",
  rule: "value",
  fingerprint: "value",
  verdict: "value",
  "remediation-minutes": "value",
  "purge-evidence": "boolean",
  actor: "value",
});

/** Fragmentos que marcan un flag como potencial credencial (siempre rechazado). */
const CREDENTIAL_HINTS = Object.freeze(["token", "secret", "password", "passwd", "auth", "apikey", "api-key", "key", "credential", "bearer"]);

const MOMENTS = Object.freeze(["agent", "pre-commit", "pr", "release"]);

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.code = "CLI_USAGE";
  }
}

/**
 * Parser allowlisted. Rechaza flags desconocidos y cualquiera que parezca
 * credencial. No evalúa nada; sólo estructura la entrada.
 */
function parse(argv) {
  const tokens = Array.isArray(argv) ? [...argv] : [];
  const flags = {};
  const positionals = [];
  let command = null;
  let subcommand = null;
  let i = 0;

  while (i < tokens.length && !tokens[i].startsWith("--")) {
    if (command === null) command = tokens[i];
    else if (["catalog", "hook", "telemetry"].includes(command) && subcommand === null) subcommand = tokens[i];
    else positionals.push(tokens[i]);
    i += 1;
  }

  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t.startsWith("--")) {
      positionals.push(t);
      continue;
    }
    let name = t.slice(2);
    let value;
    let negated = false;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (name.startsWith("no-")) {
      negated = true;
      name = name.slice(3);
    }

    const lower = name.toLowerCase();
    if (CREDENTIAL_HINTS.some((h) => lower.includes(h))) {
      throw new CliUsageError(`flag no permitido (posible credencial): --${name}`);
    }
    if (!Object.prototype.hasOwnProperty.call(KNOWN_FLAGS, name)) {
      throw new CliUsageError(`flag desconocido: --${name}`);
    }
    const type = KNOWN_FLAGS[name];
    if (negated) {
      if (type !== "boolean") throw new CliUsageError(`--no-${name} no es válido`);
      flags[name] = false;
      continue;
    }
    if (type === "boolean") {
      if (value !== undefined) throw new CliUsageError(`--${name} no acepta valor`);
      flags[name] = true;
      continue;
    }
    if (value === undefined) {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith("--")) throw new CliUsageError(`--${name} requiere un valor`);
      value = next;
      i += 1;
    }
    flags[name] = value;
  }

  return { command, subcommand, flags, positionals };
}

function printJson(stream, payload) {
  stream.write(JSON.stringify(payload, null, 2) + "\n");
}

function helpText() {
  return [
    "Kiritek engineering/guardrails CLI",
    "",
    "Uso: kiritek-init guardrails <comando> [flags]",
    "",
    "Comandos:",
    "  install [--dry-run] [--surfaces=kiro,claude,git,ci]  instala el pack y enlaza superficies",
    "  scan --moment=agent|pre-commit|pr|release   evalúa controles en un momento",
    "  validate [config]                           valida la config efectiva",
    "  audit [--unit] [--control] [--deep] [--format=text]  capacidades reales por unidad/control/momento",
    "  doctor [--unit] [--control]                 readiness para promover",
    "  promote --unit=<u> --control=<c> --to=enforce|warn [--dry-run]",
    "  feedback --control --rule --fingerprint --verdict=confirmed|false-positive",
    "  telemetry status|flush                      telemetría local/remota (opt-in)",
    "  conformance [--control]                     ejecuta las suites R27 de los controles",
    "  catalog diff --to=<version>                 plan/diff entre catálogos",
    "  update [--to=<catálogo>] [--surfaces] [--dry-run]  actualiza sin promover gates (backup + rollback)",
    "  migrate [--dry-run]                         migra instalaciones previas (idempotente)",
    "  uninstall [--dry-run] [--purge-evidence]    desinstala sólo lo engineering",
    "  hook kiro|claude --stdin-file=<f>           adaptador PreToolUse (feedback de agente)",
    "",
    "Flags: --unit --control --moment --scope --range --base --revision --catalog",
    "       --offline --dry-run --format=json --to --agent-path --artifact --surfaces",
    "       --stdin-file --warn-as=allow|ask --help --version",
  ].join("\n");
}

/** Mapea un GuardrailsError a un exit code del CLI. */
function exitForError(err) {
  const code = err && err.code ? err.code : "";
  if (code.startsWith("CONFIG")) return EXIT.CONFIG;
  if (code.startsWith("CATALOG")) return EXIT.CONFIG;
  if (code.startsWith("PLUGIN")) return EXIT.CONFIG;
  if (code.startsWith("SCOPE")) return EXIT.CONFIG;
  if (code.startsWith("PROFILE") || code.startsWith("UNIT")) return EXIT.CONFIG;
  if (code === "CLI_USAGE") return EXIT.USAGE;
  return EXIT.INTERNAL;
}

/** Construye `format`: sólo `json` es soportado (salida estable). */
function assertFormat(flags, command) {
  if (flags.format === undefined || flags.format === "json") return;
  if (flags.format === "text" && command === "audit") return;
  throw new CliUsageError(`formato no soportado: ${flags.format} (json; text sólo en audit)`);
}

/**
 * Resuelve configuración, catálogo y unidades del repo. Lanza GuardrailsError
 * con códigos estables (CONFIG o CATALOG). No toca security.
 */
function resolveContext({ cwd, flags, env, catalogOptions }) {
  // Suites aprobadas: las del pack (approved.json) + las que aporte el entorno.
  const approved = [...conformance.approvedSuites(), ...((catalogOptions && catalogOptions.approvedConformanceSuites) || [])];
  const session = createCatalogSession({ ...(catalogOptions || {}), approvedConformanceSuites: approved, offline: flags.offline === true });
  // El loader de config tiene su propia allowlist (catalog/offline/levels); le
  // pasamos SÓLO esas claves. Los demás flags del CLI (unit/control/moment/to…)
  // son de presentación o de alcance y no participan en la config efectiva.
  const configFlags = {};
  if (flags.catalog !== undefined) configFlags.catalog = flags.catalog;
  if (flags.offline !== undefined) configFlags.offline = flags.offline;
  const resolvedConfig = resolveEngineeringConfig({
    repoRoot: cwd,
    flags: configFlags,
    env,
    catalogSession: session,
  });
  const snapshot = session.snapshot;
  const resolvedUnits = resolveUnits(resolvedConfig, snapshot, { repoRoot: cwd });
  return { resolvedConfig, snapshot, resolvedUnits };
}

/** Filtro opcional por --unit/--control. */
function selected(flags, id, kind) {
  const want = flags[kind];
  return want === undefined || want === id;
}

/* ------------------------------------------------------------------ */
/* Comandos                                                            */
/* ------------------------------------------------------------------ */

function lifecycleNow(ctx) {
  return (ctx.clock || (() => new Date().toISOString()))();
}

function parseSurfaces(flags) {
  return flags.surfaces ? String(flags.surfaces).split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * install/update/migrate comparten el lifecycle transaccional (T15C): plan,
 * backup de archivos + wiring, verificación posterior y restauración
 * verificada ante cualquier fallo.
 */
function runLifecycleCommand(ctx, action) {
  const { cwd, flags, stdout, stderr } = ctx;
  const surfaces = parseSurfaces(flags);
  const unknown = surfaces.filter((s) => !["kiro", "claude", "git", "ci"].includes(s));
  if (unknown.length) {
    stderr.write(`superficie desconocida: ${unknown.join(", ")}\n`);
    printJson(stdout, { ok: false, command: action, error: "CLI_USAGE", message: `superficie desconocida: ${unknown.join(", ")}` });
    return EXIT.USAGE;
  }
  let res;
  try {
    res = runLifecycle({ repoRoot: cwd, action, dryRun: !!flags["dry-run"], surfaces, to: action === "update" ? flags.to : undefined, catalogOptions: ctx.catalogOptions, now: lifecycleNow(ctx), faultAt: ctx.faultAt });
  } catch (err) {
    stderr.write(`error en ${action}: ${err.message}\n`);
    printJson(stdout, { ok: false, command: action, error: err.code || "LIFECYCLE_ERROR", message: err.message, remediation: err.remediation });
    return err.code && /^(CONFIG|CATALOG|PLUGIN)/.test(err.code) ? EXIT.CONFIG : EXIT.INTERNAL;
  }
  const r = res.reconcile || {};
  const conflicts = r.conflicts || [];
  const payload = {
    ok: !res.rolledBack && !res.blocked && conflicts.length === 0,
    command: action,
    pack: r.pack || "engineering/guardrails",
    dryRun: !!flags["dry-run"],
    installed: r.installed,
    summary: r.summary,
    conflicts,
    proposals: r.proposals || [],
    surfaces: res.surfaces || [],
    ...(res.plan.catalog ? { catalog: { ...res.plan.catalog, nextDoc: undefined } } : {}),
    ...(res.steps ? { steps: res.steps.map(({ results, ...rest }) => rest) } : {}),
    ...(res.backupRef ? { backupRef: res.backupRef } : {}),
    ...(action === "migrate" && res.applied ? { changed: res.changed } : {}),
  };
  if (res.blocked) {
    stderr.write(`${action} detenido sin cambios: ${res.reason || (res.plan.catalog && res.plan.catalog.reason) || res.code}\n`);
    printJson(stdout, { ...payload, ok: false, blocked: true, error: res.code, reason: res.reason || (res.plan.catalog && res.plan.catalog.reason), recovery: res.plan.catalog && res.plan.catalog.recovery });
    return res.code === "MIGRATION_CONFLICT" ? EXIT.MIGRATION_CONFLICT : EXIT.CONFIG;
  }
  if (res.rolledBack) {
    stderr.write(`${action} revertido (${res.code}): ${res.error}; restauración ${res.verified ? "verificada" : "NO verificada"}\n`);
    printJson(stdout, { ...payload, ok: false, rolledBack: true, verified: res.verified, error: action === "install" ? "INSTALL_ROLLED_BACK" : res.code });
    return EXIT.MIGRATION_CONFLICT;
  }
  printJson(stdout, payload);
  if (conflicts.length) {
    stderr.write(`conflictos (propuestas .kiritek-new): ${conflicts.join(", ")}\n`);
    return EXIT.MIGRATION_CONFLICT;
  }
  return EXIT.OK;
}

const runInstall = (ctx) => runLifecycleCommand(ctx, "install");

function runUninstall(ctx) {
  const { cwd, flags, stdout, stderr } = ctx;
  let res;
  try {
    res = uninstallWithPolicy({ repoRoot: cwd, dryRun: !!flags["dry-run"], purgeEvidence: !!flags["purge-evidence"] });
  } catch (err) {
    stderr.write(`error desinstalando: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "uninstall", error: "UNINSTALL_ERROR", message: err.message });
    return EXIT.INTERNAL;
  }
  if (res.applied === false && res.rolledBack) {
    stderr.write(`desinstalación revertida: ${res.error}\n`);
    printJson(stdout, { ok: false, command: "uninstall", rolledBack: true, error: "UNINSTALL_ROLLED_BACK", restored: res.restored });
    return EXIT.MIGRATION_CONFLICT;
  }
  printJson(stdout, { ok: true, command: "uninstall", ...res });
  return EXIT.OK;
}

function runValidate(ctx) {
  const { cwd, flags, env, stdout, stderr } = ctx;
  const target = ctx.positionals[0] || "config";
  if (target !== "config") {
    stderr.write(`validate soporta: config\n`);
    printJson(stdout, { ok: false, command: "validate", error: "INVALID_TARGET", target });
    return EXIT.USAGE;
  }
  let context;
  try {
    context = resolveContext({ cwd, flags, env, catalogOptions: ctx.catalogOptions });
  } catch (err) {
    stderr.write(`configuración inválida: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "validate", error: err.code || "CONFIG_ERROR", message: err.message, pointer: err.pointer, remediation: err.remediation });
    return exitForError(err);
  }
  const { resolvedConfig, resolvedUnits } = context;
  printJson(stdout, {
    ok: true,
    command: "validate",
    target: "config",
    catalog: resolvedConfig.catalog,
    configHash: resolvedConfig.configHash,
    units: resolvedUnits.units.map((u) => ({ id: u.id, profiles: u.profiles.map((p) => `${p.id}@${p.version}`), rootStatus: u.rootStatus })),
    provenance: provenanceReport(resolvedConfig.provenance),
    diagnostics: [...resolvedConfig.diagnostics, ...resolvedUnits.diagnostics],
  });
  return EXIT.OK;
}

/**
 * Evalúa un momento con los controles builtin y las excepciones del repo.
 * @returns {Promise<{report}|{failure:{exit, payload, message}}>}
 */
async function scanReport(ctx, { moment, agentPaths }) {
  const { cwd, flags, env } = ctx;
  let context;
  try {
    context = resolveContext({ cwd, flags, env, catalogOptions: ctx.catalogOptions });
  } catch (err) {
    return { failure: { exit: exitForError(err), message: `no se pudo resolver el contexto: ${err.message}`, payload: { error: err.code || "CONFIG_ERROR", message: err.message, remediation: err.remediation } } };
  }
  const { resolvedConfig, snapshot, resolvedUnits } = context;
  let scope;
  try {
    scope = resolveScope({
      moment,
      repoRoot: cwd,
      resolvedUnits,
      workspace: resolvedConfig.effective.workspace,
      base: flags.base,
      head: flags.revision || flags.range,
      agentPaths: agentPaths || (flags["agent-path"] ? [flags["agent-path"]] : []),
      artifactRef: flags.artifact,
      selectedUnits: flags.unit ? [flags.unit] : [],
    });
  } catch (err) {
    return { failure: { exit: exitForError(err), message: `no se pudo resolver el alcance: ${err.message}`, payload: { error: err.code || "SCOPE_ERROR", message: err.message, remediation: err.remediation } } };
  }
  const nowIso = (ctx.clock || (() => new Date().toISOString()))();
  try {
    const exceptions = loadExceptions({ repoRoot: cwd, resolvedConfig, catalogSnapshot: snapshot, nowIso });
    const out = await evaluateRun({ moment, resolvedConfig, catalogSnapshot: snapshot, resolvedUnits, scope, controls: controlsFor(snapshot, { repoRoot: cwd }), exceptions, repoRoot: cwd, clock: () => nowIso });
    return { report: out.report, persisted: persistRun(cwd, resolvedConfig, out, nowIso) };
  } catch (err) {
    return { failure: { exit: err instanceof GuardrailsError ? exitForError(err) : EXIT.INTERNAL, message: `error ejecutando el scan: ${err.message}`, payload: { error: err.code || "SCAN_ERROR", message: err.message } } };
  }
}

/**
 * Persiste evidencia + registro de ejecución (fuente de la auditoría) y, si
 * está activa, telemetría local. Un fallo aquí nunca cambia la decisión.
 */
function persistRun(cwd, resolvedConfig, out, nowIso) {
  const persisted = { evidence: 0, ledger: null, telemetry: 0, diagnostics: [] };
  const directory = resolvedConfig.effective.evidence.directory;
  try {
    for (const ev of out.evidence) {
      writeEvidence({ repoRoot: cwd, directory, evidence: ev });
      persisted.evidence += 1;
    }
    persisted.ledger = audit.writeRunLedger({ repoRoot: cwd, directory, report: out.report, at: nowIso, resolvedConfig });
  } catch (err) {
    persisted.diagnostics.push({ code: "EVIDENCE_PERSIST_FAILED", message: `no se pudo registrar la ejecución (${err.code || "error"}): la auditoría la verá como unknown` });
  }
  try {
    const t = resolvedConfig.effective.telemetry;
    if (t && t.enabled === true) {
      const events = telemetry.runEvents(out.report, { at: nowIso, categories: t.categories });
      persisted.telemetry = telemetry.recordLocal(telemetry.createFileStore(cwd), events, { telemetry: t, nowIso }).recorded;
    }
  } catch (err) {
    persisted.diagnostics.push({ code: "TELEMETRY_LOCAL_FAILED", message: `telemetría local no registrada (${err.code || "error"})` });
  }
  return persisted;
}

async function runScan(ctx) {
  const { flags, stdout, stderr } = ctx;
  const moment = flags.moment;
  if (!MOMENTS.includes(moment)) {
    stderr.write(`scan requiere --moment=${MOMENTS.join("|")}\n`);
    printJson(stdout, { ok: false, command: "scan", error: "INVALID_MOMENT", moment: moment || null });
    return EXIT.USAGE;
  }
  const scanned = await scanReport(ctx, { moment });
  if (scanned.failure) {
    stderr.write(`${scanned.failure.message}\n`);
    printJson(stdout, { ok: false, command: "scan", ...scanned.failure.payload });
    return scanned.failure.exit;
  }
  const report = scanned.report;
  // Filtro de presentación por --unit/--control (no cambia la evaluación).
  const results = report.results.filter((r) => selected(flags, r.unit.id, "unit") && selected(flags, r.control.id, "control"));
  printJson(stdout, {
    ok: true,
    command: "scan",
    moment,
    catalog: report.catalog,
    configHash: report.configHash,
    revision: report.revision,
    outcome: report.outcome,
    summary: report.summary,
    results,
    exceptions: report.exceptions,
    annotations: adapters.ci.toAnnotations({ ...report, results }),
    events: report.events,
    diagnostics: [...report.diagnostics, ...scanned.persisted.diagnostics],
  });

  if (report.outcome.policyDeny) return EXIT.POLICY_DENY;
  if (report.outcome.operationalError) return EXIT.TOOL_UNAVAILABLE;
  return EXIT.OK;
}

/**
 * Adaptadores PreToolUse (T14.1–T14.3). Engineering nunca bloquea por un
 * fallo propio: evento ilegible o evaluación fallida ⇒ permitir con aviso.
 */
async function runHook(ctx) {
  const { cwd, flags, stdout, stderr } = ctx;
  const surface = ctx.subcommand;
  if (surface !== "kiro" && surface !== "claude") {
    stderr.write("hook soporta: kiro, claude\n");
    return EXIT.USAGE;
  }
  if (flags["warn-as"] !== undefined && !["allow", "ask"].includes(flags["warn-as"])) {
    stderr.write("--warn-as admite allow|ask\n");
    return EXIT.USAGE;
  }
  const respond = (r) => {
    if (r.stdout) stdout.write(`${r.stdout}\n`);
    if (r.stderr) stderr.write(`${r.stderr}\n`);
    return r.exitCode;
  };
  const unavailable = (code) => respond(surface === "kiro" ? adapters.kiro.kiroUnavailable(code) : adapters.claude.claudeUnavailable(code));
  let raw = ctx.stdinText;
  if (raw === undefined) {
    if (!flags["stdin-file"]) return unavailable("EVENT_MISSING");
    try {
      raw = require("node:fs").readFileSync(flags["stdin-file"], "utf8");
    } catch (_) {
      return unavailable("EVENT_UNREADABLE");
    }
  }
  const event = adapters.parseAgentEvent(raw, surface, cwd);
  if (!event.ok) return unavailable(event.code);
  // Operaciones no interceptables por contenido o sin rutas del repo: no se
  // simula una evaluación (cobertura posterior en pre-commit/PR).
  if (event.kind !== "write" || !event.paths.length) {
    const none = { decision: "allow", messages: [] };
    return respond(surface === "kiro" ? adapters.kiro.kiroResponse(none) : adapters.claude.claudeResponse(none));
  }
  const scanned = await scanReport(ctx, { moment: "agent", agentPaths: event.paths });
  if (scanned.failure) return unavailable(scanned.failure.payload.error || "SCAN_ERROR");
  const decision = adapters.agentDecision(scanned.report);
  return respond(surface === "kiro" ? adapters.kiro.kiroResponse(decision) : adapters.claude.claudeResponse(decision, { warnAs: flags["warn-as"] }));
}

function headRevision(cwd) {
  const res = require("node:child_process").spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" });
  return res.status === 0 && /^[0-9a-f]{7,64}$/.test(res.stdout.trim()) ? res.stdout.trim() : null;
}

/** Contexto de auditoría compartido por audit/doctor/promote. */
function auditContext(ctx, { deep = false } = {}) {
  const { cwd, flags, env } = ctx;
  const context = resolveContext({ cwd, flags, env, catalogOptions: ctx.catalogOptions });
  const { resolvedConfig, snapshot, resolvedUnits } = context;
  const nowIso = (ctx.clock || (() => new Date().toISOString()))();
  const controls = controlsFor(snapshot, { repoRoot: cwd });
  let suggestions = [];
  try {
    suggestions = discoverProfiles(cwd, { catalog: snapshot.catalog, units: resolvedUnits.units }).suggestions;
  } catch (_) {
    suggestions = [];
  }
  const exceptions = loadExceptions({ repoRoot: cwd, resolvedConfig, catalogSnapshot: snapshot, nowIso });
  const report = audit.runEngineeringAudit({ repoRoot: cwd, resolvedConfig, catalogSnapshot: snapshot, resolvedUnits, controls, nowIso, revision: headRevision(cwd), suggestions, exceptions, version: VERSION });
  if (deep) report.selfCheck = audit.runSelfChecks(controls);
  const { ledgers } = audit.readRunLedgers({ repoRoot: cwd, directory: resolvedConfig.effective.evidence.directory });
  return { ...context, nowIso, controls, exceptions, report, ledgers };
}

function runAudit(ctx) {
  const { flags, stdout, stderr } = ctx;
  let a;
  try {
    a = auditContext(ctx, { deep: !!flags.deep });
  } catch (err) {
    const nowIso = (ctx.clock || (() => new Date().toISOString()))();
    // Sin config engineering el pack está AUSENTE: no es un fallo (ni afecta a security).
    if (err.code === "CONFIG_NOT_FOUND") {
      const absent = audit.absentAudit({ nowIso, version: VERSION, reason: "kiritek-engineering.config.json ausente" });
      if (flags.format === "text") stdout.write(`${audit.renderText(absent)}\n`);
      else printJson(stdout, { ok: true, command: "audit", audit: absent });
      return EXIT.OK;
    }
    stderr.write(`no se pudo auditar: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "audit", error: err.code || "CONFIG_ERROR", message: err.message, remediation: err.remediation });
    return exitForError(err);
  }
  const report = a.report;
  report.capabilities = report.capabilities.filter((r) => selected(flags, r.unitId, "unit") && selected(flags, r.controlId, "control"));
  const { value } = prepareForPublication(report, { schema: "engineering/audit", repoRoot: ctx.cwd });
  if (flags.format === "text") {
    stdout.write(`${audit.renderText(value)}\n`);
    return EXIT.OK;
  }
  printJson(stdout, { ok: true, command: "audit", audit: value });
  return EXIT.OK;
}

/** Pares unidad/control a evaluar (selección explícita o todos los aplicables). */
function readinessTargets(a, flags) {
  const out = [];
  for (const u of a.resolvedUnits.units) {
    for (const c of a.snapshot.catalog.controls) {
      if (!selected(flags, u.id, "unit") || !selected(flags, c.id, "control")) continue;
      if (flags.unit && flags.control) out.push([u.id, c.id]);
      else if (a.report.capabilities.some((r) => r.unitId === u.id && r.controlId === c.id && r.applicable)) out.push([u.id, c.id]);
    }
  }
  if (flags.unit && flags.control && !out.length) out.push([flags.unit, flags.control]);
  return out;
}

async function readinessFor(a, unitId, controlId) {
  const events = telemetry.createFileStore(a.cwd).all();
  a.conformanceRuns = a.conformanceRuns || {};
  if (!a.conformanceRuns[controlId]) a.conformanceRuns[controlId] = await conformance.runConformance(controlId);
  return audit.assessReadiness({
    conformance: a.conformanceRuns[controlId],
    unitId,
    controlId,
    resolvedConfig: a.resolvedConfig,
    catalogSnapshot: a.snapshot,
    resolvedUnits: a.resolvedUnits,
    controls: a.controls,
    audit: a.report,
    ledgers: a.ledgers,
    selfCheck: audit.runSelfChecks(a.controls),
    exceptions: a.exceptions,
    quality: telemetry.qualityByControl(events),
    repoRoot: a.cwd,
  });
}

async function runDoctor(ctx) {
  const { flags, stdout, stderr } = ctx;
  let a;
  try {
    a = { ...auditContext(ctx), cwd: ctx.cwd };
  } catch (err) {
    stderr.write(`doctor no pudo resolver el contexto: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "doctor", error: err.code || "CONFIG_ERROR", message: err.message });
    return exitForError(err);
  }
  const readiness = [];
  for (const [u, c] of readinessTargets(a, flags)) readiness.push(await readinessFor(a, u, c));
  printJson(stdout, {
    ok: true,
    command: "doctor",
    pack: "engineering/guardrails",
    readiness: readiness.length && readiness.every((r) => r.ready) ? "ready" : "not-ready",
    blockers: [...new Set(readiness.flatMap((r) => r.blockers.map((b) => `${r.unitId}/${r.controlId} ${b}`)))],
    targets: readiness,
    units: a.resolvedUnits.units.length,
  });
  return EXIT.OK; // doctor informa; no es un fallo de uso
}

async function runPromote(ctx) {
  const { cwd, flags, stdout, stderr } = ctx;
  if (!["enforce", "warn"].includes(flags.to)) {
    stderr.write("promote requiere --to=enforce|warn\n");
    printJson(stdout, { ok: false, command: "promote", error: "INVALID_TARGET_MODE", to: flags.to || null });
    return EXIT.USAGE;
  }
  if (!flags.unit || !flags.control) {
    stderr.write("promote requiere --unit y --control (promoción granular)\n");
    printJson(stdout, { ok: false, command: "promote", error: "MISSING_SELECTOR" });
    return EXIT.USAGE;
  }
  let a;
  try {
    a = { ...auditContext(ctx), cwd };
  } catch (err) {
    stderr.write(`promote no pudo resolver el contexto: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "promote", error: err.code || "CONFIG_ERROR", message: err.message });
    return exitForError(err);
  }
  if (!a.snapshot.catalog.controls.some((c) => c.id === flags.control)) {
    stderr.write(`control desconocido: ${flags.control}\n`);
    printJson(stdout, { ok: false, command: "promote", promoted: false, error: "UNKNOWN_CONTROL", control: flags.control, blockers: [`control desconocido ${flags.control}`] });
    return EXIT.CONFIG;
  }
  // Volver a warn (rollback) no exige readiness ni pierde evidencia/config.
  const readiness = flags.to === "enforce" ? await readinessFor(a, flags.unit, flags.control) : null;
  const plan = audit.planPromotion({ repoRoot: cwd, configFile: CONFIG_FILE, unitId: flags.unit, controlId: flags.control, to: flags.to, readiness });
  const base = { command: "promote", unit: flags.unit, control: flags.control, to: flags.to, ...(readiness ? { checks: readiness.checks } : {}) };
  if (!plan.applicable) {
    const blockers = readiness && readiness.blockers.length ? readiness.blockers : [plan.reason];
    stderr.write(`promoción rechazada: ${blockers.join("; ")}\n`);
    printJson(stdout, { ok: false, ...base, promoted: false, blockers, reason: plan.reason });
    return EXIT.CONFIG;
  }
  let record = null;
  if (!flags["dry-run"]) {
    audit.applyPromotion(cwd, plan);
    record = audit.recordPromotion({ repoRoot: cwd, before: a, flags, plan, readiness, env: ctx.env, now: lifecycleNow(ctx), resolveAfter: () => resolveContext({ cwd, flags, env: ctx.env, catalogOptions: ctx.catalogOptions }).resolvedConfig.configHash });
  }
  printJson(stdout, { ok: true, ...base, promoted: !flags["dry-run"], dryRun: !!flags["dry-run"], from: plan.from, pointer: plan.pointer, blockers: [], ...(record ? { record } : {}) });
  return EXIT.OK;
}

function runFeedback(ctx) {
  const { cwd, flags, stdout, stderr } = ctx;
  for (const k of ["control", "rule", "fingerprint", "verdict"]) {
    if (!flags[k]) {
      stderr.write(`feedback requiere --${k}\n`);
      printJson(stdout, { ok: false, command: "feedback", error: "MISSING_ARGUMENT", argument: k });
      return EXIT.USAGE;
    }
  }
  const nowIso = (ctx.clock || (() => new Date().toISOString()))();
  let event;
  try {
    const minutes = flags["remediation-minutes"] === undefined ? undefined : Number(flags["remediation-minutes"]);
    event = telemetry.feedbackEvent({ controlId: flags.control, controlVersion: "1.0.0", ruleId: flags.rule, fingerprint: flags.fingerprint, verdict: flags.verdict, remediationMinutes: minutes, at: nowIso });
  } catch (err) {
    stderr.write(`${err.message}\n`);
    printJson(stdout, { ok: false, command: "feedback", error: err.code || "TELEMETRY_INVALID", message: err.message });
    return EXIT.USAGE;
  }
  // Acción explícita del usuario: se guarda localmente aunque la telemetría
  // (envío/registro automático) esté apagada; nunca sale del repo sin opt-in.
  const store = telemetry.createFileStore(cwd);
  store.append([event]);
  printJson(stdout, { ok: true, command: "feedback", recorded: { id: event.id, controlId: event.controlId, verdict: event.verdict } });
  return EXIT.OK;
}

/** Ejecuta las suites R27 empaquetadas (T16). */
async function runConformanceCommand(ctx) {
  const { flags, stdout, stderr } = ctx;
  const ids = flags.control ? [flags.control] : Object.keys(conformance.SUITES);
  const results = [];
  for (const id of ids) results.push(await conformance.runConformance(id));
  const passed = results.every((r) => r.passed);
  printJson(stdout, { ok: passed, command: "conformance", approved: conformance.approvedSuites(), results });
  if (!passed) stderr.write(`conformidad fallida: ${results.filter((r) => !r.passed).map((r) => r.control).join(", ")}\n`);
  return passed ? EXIT.OK : EXIT.CONFIG;
}

async function runTelemetry(ctx) {
  const { cwd, flags, env, stdout, stderr } = ctx;
  if (!["status", "flush"].includes(ctx.subcommand)) {
    stderr.write("telemetry soporta: status, flush\n");
    return EXIT.USAGE;
  }
  let context;
  try {
    context = resolveContext({ cwd, flags, env, catalogOptions: ctx.catalogOptions });
  } catch (err) {
    stderr.write(`${err.message}\n`);
    printJson(stdout, { ok: false, command: "telemetry", error: err.code || "CONFIG_ERROR" });
    return exitForError(err);
  }
  const t = context.resolvedConfig.effective.telemetry;
  const store = telemetry.createFileStore(cwd);
  const nowIso = (ctx.clock || (() => new Date().toISOString()))();
  let remote;
  try {
    remote = telemetry.resolveRemote(t, env);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    printJson(stdout, { ok: false, command: "telemetry", error: err.code });
    return EXIT.CONFIG;
  }
  const events = store.all();
  if (ctx.subcommand === "status") {
    printJson(stdout, { ok: true, command: "telemetry status", enabled: t.enabled === true, remote: !!remote, events: events.length, pending: events.filter((e) => !store.isDelivered(e.id)).length, alerts: telemetry.aggregateAlerts(events) });
    return EXIT.OK;
  }
  if (!remote) {
    printJson(stdout, { ok: true, command: "telemetry flush", remote: false, delivered: 0, reason: "envío remoto no habilitado (opt-in)" });
    return EXIT.OK;
  }
  const summary = await telemetry.flush(store, remote, ctx.send || telemetry.httpsSend, { nowIso });
  printJson(stdout, { ok: true, command: "telemetry flush", ...summary });
  return EXIT.OK;
}

function runCatalog(ctx) {
  const { cwd, flags, env, stdout, stderr } = ctx;
  if (ctx.subcommand !== "diff") {
    stderr.write("catalog soporta: diff\n");
    printJson(stdout, { ok: false, command: "catalog", error: "INVALID_SUBCOMMAND", subcommand: ctx.subcommand || null });
    return EXIT.USAGE;
  }
  const to = flags.to;
  if (!to) {
    stderr.write("catalog diff requiere --to=<version>\n");
    printJson(stdout, { ok: false, command: "catalog diff", error: "MISSING_TO" });
    return EXIT.USAGE;
  }
  let fromSnap;
  try {
    const context = resolveContext({ cwd, flags, env, catalogOptions: ctx.catalogOptions });
    fromSnap = context.snapshot;
  } catch (err) {
    stderr.write(`catalog diff no pudo resolver el catálogo actual: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "catalog diff", error: err.code || "CATALOG_ERROR", message: err.message });
    return exitForError(err);
  }
  let toSnap;
  try {
    toSnap = resolveCatalog({ version: to, offline: flags.offline === true });
  } catch (err) {
    stderr.write(`no se pudo resolver el catálogo objetivo ${to}: ${err.message}\n`);
    printJson(stdout, { ok: false, command: "catalog diff", error: err.code || "CATALOG_ERROR", message: err.message, remediation: err.remediation });
    return exitForError(err);
  }
  const diff = diffCatalogs(fromSnap.catalog, toSnap.catalog);
  printJson(stdout, { ok: diff.semverViolations.length === 0, command: "catalog diff", diff });
  if (diff.migrationError || diff.semverViolations.length) {
    stderr.write(`diff con problemas: ${[diff.migrationError, ...diff.semverViolations].filter(Boolean).join("; ")}\n`);
    return EXIT.CONFIG;
  }
  return EXIT.OK;
}

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

function runParsed(parsed, deps) {
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const cwd = deps.cwd || process.cwd();
  const env = deps.env || process.env;
  const { command, subcommand, flags, positionals } = parsed;

  if (flags.version) {
    printJson(stdout, { ok: true, version: VERSION });
    return EXIT.OK;
  }
  if (flags.help || !command) {
    stderr.write(helpText() + "\n");
    printJson(stdout, { ok: true, help: true });
    return EXIT.OK;
  }
  if (!COMMANDS.includes(command)) {
    stderr.write(`comando engineering desconocido: ${command}\n`);
    printJson(stdout, { ok: false, error: "UNKNOWN_COMMAND", command });
    return EXIT.USAGE;
  }

  try {
    assertFormat(flags, command);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    printJson(stdout, { ok: false, error: "USAGE", message: err.message });
    return EXIT.USAGE;
  }

  const ctx = { cwd, env, flags, positionals, subcommand, stdout, stderr, stdinText: deps.stdinText, clock: deps.clock, catalogOptions: deps.catalogOptions, send: deps.send, faultAt: deps.faultAt };
  switch (command) {
    case "install":
      return runInstall(ctx);
    case "update":
      return runLifecycleCommand(ctx, "update");
    case "migrate":
      return runLifecycleCommand(ctx, "migrate");
    case "uninstall":
      return runUninstall(ctx);
    case "validate":
      return runValidate(ctx);
    case "scan":
      return runScan(ctx);
    case "audit":
      return runAudit(ctx);
    case "doctor":
      return runDoctor(ctx);
    case "promote":
      return runPromote(ctx);
    case "catalog":
      return runCatalog(ctx);
    case "hook":
      return runHook(ctx);
    case "feedback":
      return runFeedback(ctx);
    case "telemetry":
      return runTelemetry(ctx);
    case "conformance":
      return runConformanceCommand(ctx);
    default:
      printJson(stdout, { ok: false, error: "UNKNOWN_COMMAND", command });
      return EXIT.USAGE;
  }
}

/**
 * Punto de entrada. `argv` NO incluye el token `guardrails` (lo consume el
 * router). Devuelve un exit code numérico.
 */
function run(argv, deps = {}) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (err) {
    const stderr = deps.stderr || process.stderr;
    const stdout = deps.stdout || process.stdout;
    stderr.write(`${err.message}\n`);
    stdout.write(JSON.stringify({ ok: false, error: err.code || "CLI_USAGE", message: err.message }) + "\n");
    return EXIT.USAGE;
  }
  return runParsed(parsed, deps);
}

async function runAsync(argv, deps = {}) {
  return run(argv, deps);
}

module.exports = { run, runAsync, runParsed, parse, EXIT, COMMANDS, KNOWN_FLAGS, VERSION, helpText };
