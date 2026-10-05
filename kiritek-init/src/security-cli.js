"use strict";

/**
 * Router de los comandos de seguridad del core Kiritek.
 *
 * Esta pieza NO reimplementa los comandos legacy del framework (`init`,
 * `audit`, `update` que instalan skills/agentes). Expone los comandos nuevos
 * de seguridad y, por ahora en la fase M1, resuelve configuración y emite
 * salida estructurada. Los comandos que aún no tienen motor (scan real, audit
 * por capas, provider plan) devuelven un estado `pending` honesto en vez de
 * fingir que hicieron el trabajo.
 *
 * Contrato de E/S (requisito 5.4):
 *  - stdout: SIEMPRE JSON parseable (una línea o bloque), para automatización.
 *  - stderr: diagnósticos legibles por humanos.
 *  - exit code: 0 ok, 2 error de configuración/uso.
 */

const fs = require("fs");
const { parse, CliError } = require("./cli-parser.js");
const { loadEffectiveConfig } = require("./config/load.js");
const commitsPolicy = require("./policy/commits.js");
const exceptionsPolicy = require("./policy/exceptions.js");
const promotion = require("./policy/promotion.js");
const claudeAdapter = require("./integrations/claude.js");
const kiroAdapter = require("./integrations/kiro.js");
const { resolveDefaultBranch } = require("./git/default-branch.js");
const jira = require("./integrations/jira.js");
const { jiraKeysForPush } = require("./scanners/push-scan.js");
const { createEvidence } = require("./domain/evidence.js");
const { safeSerialize } = require("./scanners/redactor.js");
const { isBlocking } = require("./domain/result.js");

const SECURITY_COMMANDS = Object.freeze([
  "scan",
  "validate",
  "security",
  "provider",
  "uninstall",
  "migrate",
]);

const VERSION = require("../package.json").version;

function printJson(out, payload) {
  out.write(JSON.stringify(payload, null, 2) + "\n");
}

/** Resume el resultado de installCore para la salida del CLI. */
function summarizeInstall(res) {
  return {
    installed: res.installed,
    dryRun: !!res.dryRun,
    projectType: res.projectType || null,
    // Modo recomendado por el instalador según repo nuevo/existente. Puede
    // diferir del `mode` configurado (base.mode); por eso se nombra aparte.
    recommendedMode: res.mode || null,
    gitRepo: res.gitRepo === undefined ? null : res.gitRepo,
    conflicts: res.reconcile ? res.reconcile.conflicts : [],
    hooks: res.hooks
      ? { strategy: res.hooks.strategy, applied: !!res.hooks.applied, installed: res.hooks.installed || [], chained: res.hooks.chained || [], reason: res.hooks.reason || null }
      : null,
    capabilities: res.capabilities,
    compliant: res.securityOff ? false : true,
  };
}

function helpText() {
  return [
    "Kiritek security CLI",
    "",
    "Uso: kiritek-init <comando> [flags]",
    "",
    "Comandos de seguridad:",
    "  scan --scope=staged|push|repository|history",
    "  validate commit|push|config",
    "  security audit [--deep] | security doctor | security promote --to=enforce",
    "  security exception validate [--file=<ruta>]",
    "  provider plan github|aws-codecommit",
    "  uninstall --security",
    "",
    "Flags comunes: --mode, --security, --default-branch, --jira, --report-dir,",
    "  --offline, --dry-run, --yes/--non-interactive, --format=json|text, --help, --version",
  ].join("\n");
}

/**
 * Ejecuta un comando de seguridad ya parseado.
 *
 * @param {object} parsed  Salida de cli-parser.parse.
 * @param {object} deps    { cwd, env, stdout, stderr }
 * @returns {number} exit code
 */
function runParsed(parsed, deps) {
  const { command, subcommand, flags, positionals } = parsed;
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const cwd = deps.cwd || process.cwd();
  const env = deps.env || process.env;

  if (flags.version) {
    printJson(stdout, { version: VERSION });
    return 0;
  }
  if (flags.help || !command) {
    stderr.write(helpText() + "\n");
    printJson(stdout, { ok: true, help: true });
    return 0;
  }

  // Para `uninstall`, `--security` es un SELECTOR del pack (presencia), no el
  // nivel de seguridad de la config (`off|warning|enforce`). Lo normalizamos
  // antes de resolver config para no chocar con el validador del flag.
  let effectiveFlags = flags;
  if (command === "uninstall" && flags.security === true) {
    effectiveFlags = { ...flags };
    delete effectiveFlags.security;
  }

  // Resolver configuración (prevalidación antes de cualquier mutación).
  let resolved;
  try {
    resolved = loadEffectiveConfig({ repoRoot: cwd, flags: effectiveFlags, env });
  } catch (err) {
    stderr.write(`error de configuración: ${err.message}\n`);
    printJson(stdout, { ok: false, error: err.code || "CONFIG_ERROR", message: err.message });
    return 2;
  }

  const base = {
    ok: true,
    command: subcommand ? `${command} ${subcommand}` : command,
    mode: resolved.config.mode,
    origin: resolved.origin,
  };

  // `--security=off`: exige confirmación y marca no conforme.
  if (resolved.security === "off") {
    if (!flags.yes && !flags["non-interactive"]) {
      stderr.write("--security=off requiere confirmación explícita (--yes). Protecciones omitidas.\n");
      printJson(stdout, { ok: false, error: "CONFIRMATION_REQUIRED", securityOff: true });
      return 2;
    }
    printJson(stdout, { ...base, securityOff: true, compliant: false });
    return 0;
  }

  switch (command) {
    case "scan": {
      const scope = flags.scope || positionals[0] || "staged";
      const allowed = ["staged", "push", "repository", "history"];
      if (!allowed.includes(scope)) {
        stderr.write(`scope inválido: ${scope}\n`);
        printJson(stdout, { ok: false, error: "INVALID_SCOPE", scope });
        return 2;
      }
      return runScan({ base, resolved, flags, cwd, scope, stdout, stderr, deps });
    }
    case "validate": {
      const target = subcommand || positionals[0];
      const allowed = ["commit", "push", "config", "claude-hook", "kiro-hook"];
      if (!allowed.includes(target)) {
        stderr.write(`validate requiere uno de: ${allowed.join(", ")}\n`);
        printJson(stdout, { ok: false, error: "INVALID_TARGET", target: target || null });
        return 2;
      }
      if (target === "config") {
        printJson(stdout, { ...base, target, configValid: true });
        return 0;
      }
      if (target === "commit") {
        return runValidateCommit({ base, resolved, flags, cwd, env, stdout, stderr });
      }
      if (target === "claude-hook") {
        return runValidateClaudeHook({ base, resolved, flags, cwd, env, stdout, stderr, deps });
      }
      if (target === "kiro-hook") {
        return runValidateKiroHook({ base, resolved, flags, cwd, env, stdout, stderr, deps });
      }
      // target === "push": validación remota de claves Jira del alcance.
      return runValidatePush({ base, resolved, flags, cwd, env, stdout, stderr, deps });
    }
    case "security": {
      if (subcommand === "install") {
        const { installCore } = require("./install/core-security.js");
        const res = installCore({
          repoRoot: cwd,
          security: resolved.security,
          dryRun: !!flags["dry-run"],
        });
        const summary = summarizeInstall(res);
        if (res.installed && !flags["dry-run"]) {
          // Deja el binario verificado en cache para que el primer commit no
          // espere una descarga. Un fallo no revierte la instalación: el
          // control queda pendiente y `scan` lo reportará como unavailable.
          const { ensureGitleaks } = require("./scanners/secrets-scan.js");
          const secretsDeps = (deps && deps.secrets) || {};
          const tool = ensureGitleaks({
            repoRoot: cwd,
            offline: flags.offline === true,
            cacheRoot: secretsDeps.cacheRoot,
            downloader: secretsDeps.downloader,
          });
          summary.gitleaks = { status: tool.status, version: tool.version || null, reason: tool.reason || null };
          summary.capabilities = (summary.capabilities || []).map((c) =>
            c.id !== "secret-scanning"
              ? c
              : tool.status === "ok"
              ? { ...c, status: "active", reason: `gitleaks ${tool.version} verificado (sha256)` }
              : { ...c, reason: `gitleaks no disponible: ${tool.reason || tool.status}` }
          );
          if (tool.status !== "ok") stderr.write(`gitleaks no disponible: ${tool.reason || tool.status}\n`);
        }
        if (res.installed || flags["dry-run"]) {
          summary.assistants = runLinkAssistants({ flags, cwd, env, dryRun: !!flags["dry-run"], stderr });
          for (const [id, link] of Object.entries(summary.assistants.results)) {
            summary.capabilities.push({
              id: `assistant-${id}`,
              status: link.status === "linked" ? "active" : "pending_configuration",
              reason: link.reason || null,
            });
          }
          if (summary.assistants.skipped) {
            summary.capabilities.push(
              { id: "assistant-claude", status: "pending_configuration", reason: summary.assistants.skipped },
              { id: "assistant-kiro", status: "pending_configuration", reason: summary.assistants.skipped }
            );
          }
        }
        printJson(stdout, { ...base, ...summary });
        return 0;
      }
      if (subcommand === "audit") {
        return runSecurityAudit({ resolved, flags, cwd, env, stdout, stderr, deps });
      }
      if (subcommand === "exception") {
        return runSecurityException({ base, resolved, flags, cwd, env, positionals, stdout, stderr, deps });
      }
      if (subcommand === "doctor") {
        return runSecurityDoctor({ base, resolved, flags, cwd, env, stdout, stderr, deps });
      }
      if (subcommand === "promote") {
        return runSecurityPromote({ base, resolved, flags, cwd, env, stdout, stderr, deps });
      }
      printJson(stdout, { ...base, status: "pending", note: "subcomando de seguridad no reconocido" });
      return 0;
    }
    case "provider": {
      return runProviderPlan({ base, resolved, subcommand, positionals, env, stdout, stderr, deps });
    }
    case "uninstall": {
      return runUninstall({ base, flags, cwd, stdout, stderr });
    }
    case "migrate": {
      return runMigrate({ base, flags, cwd, stdout, stderr });
    }
    default:
      stderr.write(`comando de seguridad desconocido: ${command}\n`);
      printJson(stdout, { ok: false, error: "UNKNOWN_COMMAND", command });
      return 2;
  }
}

/**
 * Resumen para humanos en stderr (lo que ve quien hace commit/push). El JSON
 * completo sigue yendo a stdout; los hooks lo guardan en `.kiritek/tmp/`.
 * Sólo se imprime cuando hay algo que decir (warn/deny/error).
 */
function writeHumanSummary(stderr, { label, mode, decision, results }) {
  if (decision === "allow") return;
  const blocked = isBlocking(decision);
  const lines = [
    blocked
      ? `kiritek ✖ ${label} bloqueado (modo ${mode})`
      : `kiritek ⚠ ${label}: aviso (modo ${mode}, no bloquea)`,
  ];
  let remediation = null;
  for (const r of results) {
    if (!r || r.decision === "allow") continue;
    const findings = Array.isArray(r.findings) ? r.findings : [];
    if (findings.length === 0) {
      lines.push(`  · ${r.controlId}: ${r.reason || r.decision}`);
    }
    for (const f of findings.slice(0, 10)) {
      lines.push(`  · ${r.controlId}: ${f.path}${f.lineNumber ? `:${f.lineNumber}` : ""} (${f.ruleId})`);
    }
    if (findings.length > 10) lines.push(`  · … y ${findings.length - 10} más`);
    remediation = remediation || r.remediation || (findings[0] && findings[0].remediation) || null;
  }
  if (remediation) lines.push(`  → ${remediation}`);
  stderr.write(lines.join("\n") + "\n");
}

/**
 * Ejecuta `scan --scope=staged|push|repository|history`.
 *
 * Conecta el comando con los motores reales:
 *  - staged: motor de archivos sensibles + Gitleaks (`protect --staged`).
 *  - push:   escanea el alcance pre-push leyendo el stdin del hook (o
 *    --stdin-file / fd 0) con el motor de archivos + Gitleaks sobre esos
 *    commits. Sin stdin no hay alcance: estado honesto `no-scope`.
 *            Además aplica las guardas Git (push directo a default, force).
 *  - repository/history: Gitleaks sobre el árbol actual / el historial.
 *
 * Gitleaks se resuelve desde el manifiesto pinneado (secrets-scan.js). Si no
 * está disponible el control queda `unavailable` (warn en warning, error en
 * enforce): nunca se declara "sin hallazgos" sin ejecutar. La decisión final es
 * la más severa de los controles (`controls` lleva cada uno).
 *
 * La salida cruza SIEMPRE el redactor obligatorio. Exit codes: 0 allow/warn,
 * 1 deny (hallazgos en enforce) / error, 2 uso incorrecto.
 *
 * @returns {number} exit code
 */
function runScan(ctx) {
  const { base, resolved, flags, cwd, scope, stdout, stderr, deps } = ctx;
  const mode = resolved.config.mode;
  const { scanSecrets, loadGovernedExceptions, mostSevere } = require("./scanners/secrets-scan.js");
  const exceptions = ((resolved.config && resolved.config.exceptions) || []).concat(loadGovernedExceptions(cwd, mode));
  const secretsOpts = {
    repoRoot: cwd,
    mode,
    offline: flags.offline === true,
    historyDepth: resolved.config.secrets && resolved.config.secrets.historyDepth,
    deps: (deps && deps.secrets) || {},
  };

  let scan;
  try {
    if (scope === "staged") {
      const { scanStaged } = require("./scanners/staged-scan.js");
      const out = scanStaged({ repoRoot: cwd, mode, exceptions });
      const secrets = scanSecrets({ ...secretsOpts, scope });
      scan = { results: [out.result, secrets.result], scanned: out.files.length, overBudget: out.overBudget, tool: secrets.tool };
    } else if (scope === "push") {
      const { scanPush } = require("./scanners/push-scan.js");
      let stdin;
      try {
        stdin = readPushStdin(flags, deps || {});
      } catch (err) {
        stderr.write(`no se pudo leer el stdin de pre-push: ${err.message}\n`);
        printJson(stdout, { ...base, scope, ok: false, error: "STDIN_READ_ERROR" });
        return 2;
      }
      if (!stdin || stdin.trim() === "") {
        // Sin alcance no hay nada que escanear; no fingimos "limpio".
        printJson(stdout, { ...base, scope, status: "no-scope", note: "sin stdin de pre-push: no hay alcance que escanear" });
        return 0;
      }
      const out = scanPush({ repoRoot: cwd, stdin, remote: typeof flags.remote === "string" ? flags.remote : "origin", mode, exceptions });
      const secrets = scanSecrets({ ...secretsOpts, scope, commits: out.commits });
      const { evaluatePushGuards } = require("./git/push-guards.js");
      const guards = evaluatePushGuards({ repoRoot: cwd, stdin, mode, config: resolved.config, remote: typeof flags.remote === "string" ? flags.remote : undefined });
      scan = { results: [guards, out.result, secrets.result], scanned: out.files.length, commits: out.commits.length, tool: secrets.tool };
    } else {
      // repository / history: sólo Gitleaks (el motor de archivos opera sobre
      // cambios, no sobre el árbol completo).
      const secrets = scanSecrets({ ...secretsOpts, scope });
      scan = { results: [secrets.result], tool: secrets.tool };
    }
  } catch (err) {
    stderr.write(`error ejecutando el escaneo: ${err.message}\n`);
    printJson(stdout, { ...base, scope, ok: false, error: "SCAN_ERROR" });
    return 1;
  }
  scan.result = mostSevere(scan.results);
  if (scan.tool && scan.tool.status !== "ok" && scan.tool.status !== "not-needed") {
    stderr.write(`gitleaks no disponible: ${scan.tool.reason || scan.tool.status}\n`);
  }

  const decision = scan.result.decision;
  const blocking = isBlocking(decision);
  const exitCode = blocking ? 1 : 0;

  // `result` es una copia: el redactor marca como [CIRCULAR] un mismo objeto
  // que aparece dos veces (result y controls).
  const payload = { ...base, scope, decision, result: JSON.parse(JSON.stringify(scan.result)), controls: scan.results, scanned: scan.scanned };
  if (scan.tool && scan.tool.version) payload.gitleaksVersion = scan.tool.version;
  if (scan.overBudget !== undefined) payload.overBudget = scan.overBudget;
  if (scan.commits !== undefined) payload.commits = scan.commits;

  let serialized;
  try {
    serialized = safeSerialize(payload);
  } catch (err) {
    stderr.write(`redacción insuficiente, publicación bloqueada: ${err.message}\n`);
    printJson(stdout, { ...base, scope, ok: false, error: "REDACTION_FAILED" });
    return 1;
  }
  writeHumanSummary(stderr, {
    label: scope === "staged" ? "commit" : scope === "push" ? "push" : `scan ${scope}`,
    mode,
    decision,
    results: scan.results,
  });
  stdout.write(serialized.json + "\n");
  return exitCode;
}

/**
 * Enlaza los hooks de Claude Code y Kiro durante `security install`.
 *
 * `--assistants=claude,kiro|none` decide explícitamente. Sin el flag se enlazan
 * ambos SÓLO si `kiritek-init` está en el PATH: los shims bloquean todo
 * (fail-safe) cuando no encuentran el CLI, y enlazarlos sin él dejaría al
 * asistente inutilizable.
 */
function runLinkAssistants({ flags, cwd, env, dryRun, stderr }) {
  const assistantsMod = require("./install/assistants.js");
  let wanted;
  if (typeof flags.assistants === "string") {
    wanted = flags.assistants === "none" ? [] : flags.assistants.split(",").map((s) => s.trim()).filter((s) => s === "claude" || s === "kiro");
  } else if (assistantsMod.cliInPath(env)) {
    wanted = ["claude", "kiro"];
  } else {
    const skipped = "kiritek-init no está en el PATH: los hooks de asistentes no se enlazan (bloquearían todo). Instálalo global y repite `security install`, o usa --assistants=claude,kiro";
    stderr.write(`asistentes: ${skipped}\n`);
    return { skipped, results: {} };
  }
  const results = assistantsMod.linkAssistants({ repoRoot: cwd, assistants: wanted, dryRun });
  for (const [id, r] of Object.entries(results)) {
    if (r.status === "conflict") stderr.write(`asistente ${id}: ${r.reason}\n`);
  }
  return { skipped: null, results };
}

/**
 * Ejecuta `uninstall [--security] [--dry-run]`: desinstalación selectiva de los
 * artefactos propiedad de Kiritek, delegando en `install/uninstall.js`.
 *
 * Sólo toca artefactos registrados en el inventario: los `owned`/`generated`
 * no personalizados se eliminan, los `managed-block` sólo pierden su bloque
 * Kiritek (se preserva el contenido del usuario), y lo personalizado (drift) se
 * conserva y se reporta para decisión manual. Todo bajo transacción con
 * rollback. `--dry-run` calcula el plan sin mutar.
 *
 * @returns {number} exit code: 0 ok, 1 fallo (rollback).
 */
function runUninstall(ctx) {
  const { base, flags, cwd, stdout, stderr } = ctx;
  const { uninstall } = require("./install/uninstall.js");
  let res;
  try {
    res = uninstall({ repoRoot: cwd, dryRun: !!flags["dry-run"] });
  } catch (err) {
    stderr.write(`error desinstalando: ${err.message}\n`);
    printJson(stdout, { ...base, ok: false, error: "UNINSTALL_ERROR", message: err.message });
    return 1;
  }
  if (res.applied === false && res.rolledBack) {
    stderr.write(`desinstalación revertida: ${res.error}\n`);
    printJson(stdout, { ...base, ok: false, rolledBack: true, error: "UNINSTALL_ROLLED_BACK", restored: res.restored });
    return 1;
  }
  // Los enlaces de asistentes no viven en el inventario: se deshacen aparte y
  // sólo quitan lo que es de Kiritek.
  const { unlinkAssistants } = require("./install/assistants.js");
  const assistants = unlinkAssistants({ repoRoot: cwd, dryRun: !!flags["dry-run"] });
  printJson(stdout, { ...base, ...res, assistants });
  return 0;
}

/**
 * Ejecuta `migrate [--dry-run]`: migración reentrante y transaccional de
 * instalaciones previas (0.1.0), parciales o personalizadas al modelo con
 * inventario + seguridad integral. Delega en `install/migrate.js`.
 *
 * Nunca pisa el trabajo del usuario: adopta artefactos legacy en el inventario,
 * instala el baseline del core en modo `warning`, y para un workflow inseguro
 * personalizado deja una propuesta `.kiritek-new` en vez de sobrescribir. El
 * veredicto de conformidad es HONESTO: `compliant:false` mientras exista un
 * conflicto crítico sin resolver. `--dry-run` calcula el plan sin mutar.
 *
 * @returns {number} exit code: 0 ok/plan; 1 si la migración no es conforme o
 *   falló (rollback).
 */
function runMigrate(ctx) {
  const { base, flags, cwd, stdout, stderr } = ctx;
  const migrateMod = require("./install/migrate.js");
  let res;
  try {
    res = migrateMod.migrate({ repoRoot: cwd, dryRun: !!flags["dry-run"] });
  } catch (err) {
    stderr.write(`error migrando: ${err.message}\n`);
    printJson(stdout, { ...base, ok: false, error: "MIGRATE_ERROR", message: err.message });
    return 1;
  }

  let serialized;
  try {
    serialized = safeSerialize({ ...base, ...res });
  } catch (err) {
    stderr.write(`redacción insuficiente, publicación bloqueada: ${err.message}\n`);
    printJson(stdout, { ...base, ok: false, error: "REDACTION_FAILED" });
    return 1;
  }

  if (res.applied === false && !res.dryRun) {
    stderr.write(`migración no aplicada: ${(res.compliantBlockers || []).join("; ") || res.error || "fallo"}\n`);
    stdout.write(serialized.json + "\n");
    return 1;
  }
  // Conformidad honesta: un conflicto crítico sin resolver no es exit 0 limpio.
  if (res.compliant === false && !res.dryRun) {
    stderr.write(`migración aplicada con conflictos críticos abiertos: ${(res.compliantBlockers || []).join("; ")}\n`);
    stdout.write(serialized.json + "\n");
    return 1;
  }
  stdout.write(serialized.json + "\n");
  return 0;
}

/**
 * Lee el mensaje de commit desde `--message-file` (ruta del hook commit-msg) o
 * desde `--message`. Devuelve null si no hay fuente.
 */
function readCommitMessage(flags) {
  if (typeof flags["message-file"] === "string" && flags["message-file"].trim() !== "") {
    // No evaluamos el contenido como shell; sólo lo leemos como texto.
    return fs.readFileSync(flags["message-file"], "utf8");
  }
  if (typeof flags.message === "string") return flags.message;
  return null;
}

/**
 * Ejecuta `validate commit`: valida Conventional Commits + sintaxis Jira local.
 *
 * La salida pasa SIEMPRE por el redactor antes de stdout, y se registra
 * evidencia mínima (comando, versión, alcance, timestamp, exit code).
 * El resultado es validación SINTÁCTICA; nunca prueba de existencia remota.
 *
 * @returns {number} exit code (0 allow/warn, 1 deny/error).
 */
function runValidateCommit(ctx) {
  const { base, resolved, flags, stdout, stderr } = ctx;

  let message;
  try {
    message = readCommitMessage(flags);
  } catch (err) {
    stderr.write(`no se pudo leer el mensaje de commit: ${err.message}\n`);
    printJson(stdout, { ...base, target: "commit", ok: false, error: "MESSAGE_READ_ERROR" });
    return 2;
  }
  if (message === null) {
    stderr.write("validate commit requiere --message-file=<ruta> o --message=<texto>\n");
    printJson(stdout, { ...base, target: "commit", ok: false, error: "MESSAGE_REQUIRED" });
    return 2;
  }

  const policyResult = commitsPolicy.evaluateCommit({
    message,
    branch: typeof flags.branch === "string" ? flags.branch : undefined,
    mode: resolved.config.mode,
    config: resolved.config,
  });

  const blocking = isBlocking(policyResult.decision);
  const exitCode = blocking ? 1 : 0;

  // Evidencia mínima reproducible (sin valores sensibles).
  const evidence = createEvidence({
    control: commitsPolicy.CONTROL_ID,
    command: "kiritek-init validate commit",
    toolVersion: VERSION,
    configHash: hashConfig(resolved.config),
    scope: "commit",
    exitCode,
    decision: policyResult.decision,
  });

  const payload = {
    ...base,
    target: "commit",
    decision: policyResult.decision,
    // Etiqueta explícita: validación local sintáctica, no existencia remota.
    validation: policyResult.meta ? policyResult.meta.validation : commitsPolicy.SYNTACTIC_VALIDATION,
    remoteVerification: policyResult.meta ? policyResult.meta.remoteVerification : commitsPolicy.REMOTE_UNVERIFIED,
    result: policyResult,
    evidence,
  };

  // El redactor es obligatorio: si quedara un canario, bloquea la publicación.
  let serialized;
  try {
    serialized = safeSerialize(payload);
  } catch (err) {
    stderr.write(`redacción insuficiente, publicación bloqueada: ${err.message}\n`);
    printJson(stdout, { ...base, target: "commit", ok: false, error: "REDACTION_FAILED" });
    return 1;
  }

  writeHumanSummary(stderr, { label: "mensaje de commit", mode: resolved.config.mode, decision: policyResult.decision, results: [policyResult] });
  stdout.write(serialized.json + "\n");
  return exitCode;
}

/**
 * Ejecuta `validate claude-hook`: evalúa un evento `PreToolUse` de Claude Code.
 *
 * Contrato fail-safe (requisito 24.2): CUALQUIER error — stdin vacío, JSON
 * inválido, excepción de evaluación o fallo de redacción — resulta en EXIT 2
 * (bloqueo), nunca en un permiso implícito. Claude trata exit 2 como bloqueo
 * aun si hubiera un `allow`.
 *
 * La salida a stdout es el JSON `hookSpecificOutput` que Claude consume. stderr
 * lleva diagnóstico humano REDACTADO. Nunca se registran prompts/código/valores
 * del `tool_input`.
 *
 * @returns {number} exit code: 0 permite/ask; 2 bloqueo o fail-safe.
 */
function runValidateClaudeHook(ctx) {
  const { base, resolved, flags, cwd, env, stdout, stderr, deps } = ctx;

  let raw;
  try {
    raw = readPushStdin(flags, deps || {});
  } catch (err) {
    // No se pudo leer el stdin → fail-safe: bloquear.
    stderr.write("claude-hook: no se pudo leer el evento; se bloquea por seguridad.\n");
    emitClaudeDeny(stdout, "No se pudo leer el evento del hook; bloqueado por seguridad.");
    return 2;
  }

  const parsed = claudeAdapter.parseStdin(raw);
  if (!parsed.ok) {
    // Payload vacío/malformado/evento equivocado → fail-safe: bloquear.
    stderr.write(`claude-hook: evento inválido (${parsed.error}); se bloquea por seguridad.\n`);
    emitClaudeDeny(stdout, "Evento del hook inválido; bloqueado por seguridad.");
    return 2;
  }

  // Resolver rama default para la guarda Git (best-effort; sin asumir main).
  let defaultBranch = null;
  try {
    const explicit =
      resolved.config.defaultBranch && resolved.config.defaultBranch.explicit;
    const remote =
      (resolved.config.defaultBranch && resolved.config.defaultBranch.remote) || "origin";
    const r = resolveDefaultBranch({ repoRoot: cwd, remote, explicit });
    defaultBranch = r.branch;
  } catch (_) {
    defaultBranch = null;
  }

  const askOnWarn =
    resolved.config.assistants &&
    resolved.config.assistants.claude &&
    resolved.config.assistants.claude.askOnMediumRisk === true;

  let evalResult;
  try {
    evalResult = claudeAdapter.evaluateEvent(
      // El cwd del evento manda; si falta, usamos el cwd del proceso.
      { ...parsed.event, cwd: parsed.event.cwd || cwd },
      {
        mode: resolved.config.mode,
        defaultBranch,
        forcePolicy: (resolved.config.git && resolved.config.git.forcePolicy) || "deny",
        askOnWarn: !!askOnWarn,
      }
    );
  } catch (err) {
    // Fallo de evaluación → fail-safe: bloquear (nunca permitir por defecto).
    stderr.write("claude-hook: fallo evaluando la política; se bloquea por seguridad.\n");
    emitClaudeDeny(stdout, "Fallo evaluando la política; bloqueado por seguridad.");
    return 2;
  }

  const output = claudeAdapter.buildHookOutput(evalResult);

  // La salida debe cruzar el redactor obligatorio. Si quedara un canario, se
  // bloquea con un mensaje genérico (fail-closed).
  let serialized;
  try {
    serialized = safeSerialize(output);
  } catch (err) {
    stderr.write("claude-hook: redacción insuficiente; se bloquea por seguridad.\n");
    emitClaudeDeny(stdout, "Detalle redactado; bloqueado por seguridad.");
    return 2;
  }

  stdout.write(serialized.json + "\n");

  if (evalResult.blocking) {
    if (evalResult.reason) stderr.write(`claude-hook: operación bloqueada: ${evalResult.reason}\n`);
    // exit 2 es el fail-safe de bloqueo que Claude respeta por encima de todo.
    return 2;
  }
  return 0;
}

/**
 * Emite una decisión `deny` segura para Claude (sin valores sensibles).
 */
function emitClaudeDeny(stdout, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: claudeAdapter.HOOK_EVENT,
      permissionDecision: claudeAdapter.PERMISSION.DENY,
      permissionDecisionReason: reason,
    },
  };
  // Redacción obligatoria; el mensaje es genérico, no debería tener canarios.
  try {
    stdout.write(safeSerialize(output).json + "\n");
  } catch (_) {
    stdout.write(JSON.stringify(output) + "\n");
  }
}

/**
 * Ejecuta `validate kiro-hook`: evalúa un evento `PreToolUse` de Kiro.
 *
 * Diferencia con Claude: Kiro decide POR EXIT CODE, no por un bloque
 * `permissionDecision`. El contrato es `deny → exit 2` (bloquea, stderr llega
 * al agente), `allow`/`warn → exit 0` (permite). Cualquier OTRO código Kiro lo
 * trata como fallo del hook NO BLOQUEANTE; por eso toda ruta de este comando
 * resuelve deliberadamente a 0 ó 2, nunca a otro valor.
 *
 * Contrato fail-safe (requisito 25.2/25.7): stdin vacío, JSON inválido, excepción
 * de evaluación o fallo de redacción resultan en EXIT 2 (bloqueo), nunca en un
 * permiso implícito.
 *
 * stdout emite un JSON REDACTADO sólo para automatización/evidencia (Kiro no lo
 * consume para decidir). stderr lleva la causa/ruta/remediación REDACTADAS.
 * Nunca se registran prompts/código/valores del `tool_input`.
 *
 * @returns {number} exit code: 0 permite; 2 bloqueo o fail-safe. (Jamás otro.)
 */
function runValidateKiroHook(ctx) {
  const { base, resolved, flags, cwd, env, stdout, stderr, deps } = ctx;

  let raw;
  try {
    raw = readPushStdin(flags, deps || {});
  } catch (err) {
    stderr.write("kiro-hook: no se pudo leer el evento; se bloquea por seguridad.\n");
    emitKiroResult(stdout, { blocking: true, reason: "No se pudo leer el evento del hook; bloqueado por seguridad." });
    return kiroAdapter.EXIT.BLOCK;
  }

  const parsed = kiroAdapter.parseStdin(raw);
  if (!parsed.ok) {
    // Payload vacío/malformado/evento equivocado → fail-safe: bloquear (exit 2).
    // Nota honesta: Kiro trata un código distinto de 0/2 como fallo no
    // bloqueante; por eso elegimos deliberadamente exit 2 ante malformados.
    stderr.write(`kiro-hook: evento inválido (${parsed.error}); se bloquea por seguridad.\n`);
    emitKiroResult(stdout, { blocking: true, reason: "Evento del hook inválido; bloqueado por seguridad." });
    return kiroAdapter.EXIT.BLOCK;
  }

  // Resolver rama default para la guarda Git (best-effort; sin asumir main).
  let defaultBranch = null;
  try {
    const explicit = resolved.config.defaultBranch && resolved.config.defaultBranch.explicit;
    const remote = (resolved.config.defaultBranch && resolved.config.defaultBranch.remote) || "origin";
    const r = resolveDefaultBranch({ repoRoot: cwd, remote, explicit });
    defaultBranch = r.branch;
  } catch (_) {
    defaultBranch = null;
  }

  let evalResult;
  try {
    evalResult = kiroAdapter.evaluateEvent(
      { ...parsed.event, cwd: parsed.event.cwd || cwd },
      {
        mode: resolved.config.mode,
        defaultBranch,
        forcePolicy: (resolved.config.git && resolved.config.git.forcePolicy) || "deny",
      }
    );
  } catch (err) {
    // Fallo de evaluación → fail-safe: bloquear (nunca permitir por defecto).
    stderr.write("kiro-hook: fallo evaluando la política; se bloquea por seguridad.\n");
    emitKiroResult(stdout, { blocking: true, reason: "Fallo evaluando la política; bloqueado por seguridad." });
    return kiroAdapter.EXIT.BLOCK;
  }

  // JSON informativo (redactado) para automatización/evidencia.
  const payload = {
    hookEventName: kiroAdapter.HOOK_EVENT,
    decision: evalResult.decision,
    blocked: evalResult.blocking,
    controlId: evalResult.controlId || null,
    reason: evalResult.reason || null,
  };

  let serialized;
  try {
    serialized = safeSerialize(payload);
  } catch (err) {
    // Redacción insuficiente → fail-closed: bloquear con mensaje genérico.
    stderr.write("kiro-hook: redacción insuficiente; se bloquea por seguridad.\n");
    emitKiroResult(stdout, { blocking: true, reason: "Detalle redactado; bloqueado por seguridad." });
    return kiroAdapter.EXIT.BLOCK;
  }

  stdout.write(serialized.json + "\n");

  if (evalResult.blocking) {
    // stderr llega al agente de Kiro: causa/ruta/remediación ya redactadas.
    if (evalResult.reason) stderr.write(`kiro-hook: operación bloqueada: ${evalResult.reason}\n`);
    return kiroAdapter.EXIT.BLOCK;
  }
  return kiroAdapter.EXIT.ALLOW;
}

/**
 * Emite el JSON informativo (redactado) de una decisión de Kiro. La decisión
 * efectiva la lleva el EXIT CODE; este JSON es sólo para automatización.
 */
function emitKiroResult(stdout, { blocking, reason }) {
  const payload = {
    hookEventName: kiroAdapter.HOOK_EVENT,
    decision: blocking ? "deny" : "allow",
    blocked: !!blocking,
    reason: reason || null,
  };
  try {
    stdout.write(safeSerialize(payload).json + "\n");
  } catch (_) {
    stdout.write(JSON.stringify(payload) + "\n");
  }
}

/**
 * Lee el stdin del hook pre-push / de los hooks de agente. Precedencia:
 *   1. `--stdin-file=<ruta>`  (explícito; usado por CI/depuración)
 *   2. `deps.stdinData`        (inyectable para pruebas; NO toca el proceso)
 *   3. `deps.readStdinFd0`     (inyectable: lector del descriptor 0)
 *   4. stdin REAL del proceso (fd 0) cuando viene por tubería (no TTY)
 *
 * El caso 4 es el que hace que los hooks reales funcionen: Git (pre-push),
 * Claude Code y Kiro entregan el evento por stdin SIN pasar `--stdin-file`.
 * Sólo se lee de fd 0 cuando stdin NO es un TTY, para no colgar ejecuciones
 * interactivas esperando una entrada que nunca llega. No se evalúa como shell;
 * sólo se lee como texto.
 */
function readPushStdin(flags, deps) {
  deps = deps || {};
  if (typeof flags["stdin-file"] === "string" && flags["stdin-file"].trim() !== "") {
    return fs.readFileSync(flags["stdin-file"], "utf8");
  }
  if (typeof deps.stdinData === "string") return deps.stdinData;
  if (typeof deps.readStdinFd0 === "function") return deps.readStdinFd0();
  return readProcessStdin(deps.stdin || process.stdin);
}

/**
 * Lee de forma síncrona el stdin real del proceso cuando llega por tubería.
 * Devuelve string vacío si stdin es un TTY (ejecución interactiva) o si no hay
 * datos, de modo que el llamador aplique su contrato fail-safe sin bloquearse.
 *
 * @param {object} stdin stream de stdin (por defecto process.stdin)
 * @returns {string}
 */
function readProcessStdin(stdin) {
  // Un TTY significa que no hay nada canalizado: no debemos esperar input.
  if (!stdin || stdin.isTTY) return "";
  const fd = typeof stdin.fd === "number" ? stdin.fd : 0;
  try {
    return fs.readFileSync(fd, "utf8");
  } catch (err) {
    // EAGAIN: stdin no bloqueante y sin datos todavía (p. ej. algunos TTY).
    // EOF / sin datos: tratamos como vacío y dejamos actuar al fail-safe.
    if (err && (err.code === "EAGAIN" || err.code === "ENXIO")) return "";
    throw err;
  }
}

/**
 * Ejecuta `validate push`: valida REMOTAMENTE la existencia de las claves Jira
 * del alcance del push. Comparte el extractor de claves con pre-push y CI, de
 * modo que ambos validan EXACTAMENTE las mismas claves (paridad, 10.1–10.2).
 *
 * Las credenciales vienen SÓLO del entorno; nunca se imprimen. La salida pasa
 * por el redactor obligatorio antes de stdout.
 *
 * @returns {number} exit code (0 allow/warn, 1 deny/error).
 */
function runValidatePush(ctx) {
  const { base, resolved, flags, cwd, env, stdout, stderr, deps } = ctx;

  let stdin;
  try {
    stdin = readPushStdin(flags, deps || {});
  } catch (err) {
    stderr.write(`no se pudo leer el stdin de pre-push: ${err.message}\n`);
    printJson(stdout, { ...base, target: "push", ok: false, error: "STDIN_READ_ERROR" });
    return 2;
  }

  // Claves Jira del alcance (mismas para pre-push y CI).
  let keys = [];
  try {
    const extracted = jiraKeysForPush({
      repoRoot: cwd,
      stdin,
      remote: typeof flags.remote === "string" ? flags.remote : "origin",
      config: resolved.config,
      branch: typeof flags.branch === "string" ? flags.branch : undefined,
    });
    keys = extracted.keys;
  } catch (err) {
    // Si no se puede calcular el alcance, no fingimos verificación.
    stderr.write(`no se pudo calcular el alcance del push: ${err.message}\n`);
    printJson(stdout, { ...base, target: "push", ok: false, error: "SCOPE_ERROR" });
    return 2;
  }

  // El transporte real sólo se usa fuera de pruebas; los tests inyectan uno.
  const transport = (deps && deps.jiraTransport) || jira.createRestTransport();
  const scope = typeof flags.event === "string" && flags.event.trim() !== "" ? `ci:${flags.event}` : "push";

  // verifyKeys es async; esta ruta del CLI es asíncrona (ver runAsync).
  return jira
    .verifyKeys(
      { keys, mode: resolved.config.mode, config: resolved.config, env, scope },
      { transport, cache: deps && deps.jiraCache, clock: deps && deps.clock, idGenerator: deps && deps.idGenerator }
    )
    .then(
      (policyResult) => emitPushResult({ base, policyResult, keys, stdout, stderr }),
      (err) => {
        stderr.write(`error validando claves Jira: ${err.message}\n`);
        printJson(stdout, { ...base, target: "push", ok: false, error: "JIRA_VERIFY_ERROR" });
        return 1;
      }
    );
}

/** Serializa (redacta) y emite el resultado de `validate push`. */
function emitPushResult({ base, policyResult, keys, stdout, stderr }) {
  const blocking = isBlocking(policyResult.decision);
  const exitCode = blocking ? 1 : 0;

  const payload = {
    ...base,
    target: "push",
    decision: policyResult.decision,
    // Estado remoto explícito: nunca "verificado" en un fallback.
    remoteState: policyResult.meta ? policyResult.meta.remoteState : null,
    verified: policyResult.meta ? policyResult.meta.verified : false,
    keys,
    result: policyResult,
    // Copia superficial: `policyResult` ya incluye `evidence`, y el redactor
    // colapsa referencias repetidas; una copia evita ese colapso para exponer
    // la evidencia también a nivel superior.
    evidence: { ...policyResult.evidence },
  };

  let serialized;
  try {
    serialized = safeSerialize(payload);
  } catch (err) {
    stderr.write(`redacción insuficiente, publicación bloqueada: ${err.message}\n`);
    printJson(stdout, { ...base, target: "push", ok: false, error: "REDACTION_FAILED" });
    return 1;
  }

  writeHumanSummary(stderr, { label: "push (jira)", mode: base.mode, decision: policyResult.decision, results: [policyResult] });
  stdout.write(serialized.json + "\n");
  return exitCode;
}

/**
 * Ejecuta `security audit [--deep]`: auditoría profunda por capacidades.
 *
 * Con `--deep` se corre el self-check sintético (canario que el gate debe
 * atrapar, con limpieza y redacción garantizadas) y, si Jira está configurado,
 * se intenta OBSERVAR el tenant remotamente mediante un probe. El transporte es
 * inyectable (`deps.jiraTransport`); en producción usa el REST real; en pruebas
 * se inyecta un mock, de modo que la suite nunca abre red.
 *
 * Las credenciales se leen SÓLO del entorno y jamás se imprimen. La salida JSON
 * es estable y schema-válida; los exit codes son coherentes (0 ok, 1 falla,
 * 3 desconocido-que-importa).
 *
 * @returns {Promise<number>} exit code
 */
function runSecurityAudit(ctx) {
  const { resolved, flags, cwd, env, stdout, stderr, deps } = ctx;
  const cap = require("./audit/capabilities.js");
  const report = require("./audit/report.js");
  const config = resolved.config;
  const deep = flags.deep === true;

  // El probe Jira sólo se arma si Jira está habilitado; nunca abre red por sí
  // mismo (delega en el transporte). En pruebas se inyecta `deps.jiraTransport`.
  const jiraEnabled = config && config.jira && config.jira.enabled === true;
  const jiraProbe =
    jiraEnabled && !flags.offline
      ? (deps && deps.jiraTransport) || jira.createRestTransport()
      : undefined;

  return cap
    .runCapabilityAuditAsync(cwd, {
      config,
      env,
      deep,
      jiraProbe,
      selfCheckDeps: (deps && deps.selfCheckDeps) || {},
      now: deps && deps.now ? () => new Date(deps.now()).toISOString() : undefined,
    })
    .then(
      (audit) => {
        let rendered;
        try {
          rendered = report.renderAudit(audit);
        } catch (err) {
          stderr.write(`auditoría inválida: ${err.message}\n`);
          printJson(stdout, { ok: false, error: err.code || "AUDIT_ERROR", message: err.message });
          return 2;
        }
        // La salida ya es segura por contrato (nunca incluye valores sensibles),
        // pero cruzamos el serializador seguro como última barrera de redacción.
        let safeJson;
        try {
          safeJson = safeSerialize(audit).json;
        } catch (err) {
          stderr.write(`redacción insuficiente en la auditoría; publicación bloqueada: ${err.message}\n`);
          printJson(stdout, { ok: false, error: "REDACTION_FAILED" });
          return 1;
        }
        stderr.write(rendered.human + "\n");
        stdout.write(safeJson + "\n");
        return rendered.exitCode;
      },
      (err) => {
        stderr.write(`error ejecutando la auditoría: ${err.message}\n`);
        printJson(stdout, { ok: false, error: "AUDIT_RUN_ERROR", message: err.message });
        return 1;
      }
    );
}

/**
 * Ejecuta `security exception validate --file=<ruta>`: carga un archivo de
 * excepciones, valida cada entrada bajo la capa de gobernanza (aprobador
 * distinto, amplitud, expiración, mecanismos prohibidos, break-glass) y emite
 * un resumen REDACTADO (cantidad/edad/owner/estado, sin contenido sensible).
 *
 * Exit codes coherentes: 0 si todas válidas; 1 si alguna entrada es inválida o
 * el archivo no se puede cargar; 2 ante uso incorrecto (acción desconocida).
 * El reporte cruza SIEMPRE el redactor obligatorio (fail-closed).
 *
 * @returns {number} exit code
 */
function runSecurityException(ctx) {
  const { base, resolved, flags, cwd, positionals, stdout, stderr } = ctx;
  const action = positionals[0] || "validate";
  if (action !== "validate") {
    stderr.write(`security exception requiere la acción: validate\n`);
    printJson(stdout, { ...base, ok: false, error: "INVALID_ACTION", action });
    return 2;
  }

  // Ruta del archivo de excepciones: --file o el default administrado.
  const file =
    typeof flags.file === "string" && flags.file.trim() !== ""
      ? flags.file
      : require("path").join(cwd, ".kiritek", "exceptions.json");

  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    stderr.write(`no se pudo leer el archivo de excepciones: ${err.message}\n`);
    printJson(stdout, { ...base, target: "exception", ok: false, error: "FILE_READ_ERROR" });
    return 1;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    stderr.write(`archivo de excepciones con JSON inválido: ${err.message}\n`);
    printJson(stdout, { ...base, target: "exception", ok: false, error: "FILE_PARSE_ERROR" });
    return 1;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.exceptions)
    ? parsed.exceptions
    : [];

  const mode = resolved.config.mode;
  // Validación entrada por entrada. Nunca incluimos el contenido crudo en la
  // salida: sólo índice, validez y una razón (textual, no sensible).
  const results = list.map((exc, index) => {
    const v = exceptionsPolicy.validateException(exc, { mode });
    return { index, valid: v.valid, type: v.type, errors: v.errors };
  });
  const invalid = results.filter((r) => !r.valid);

  // Protección por ownership remoto: honesta cuando no hay fuente disponible.
  const ownership = exceptionsPolicy.assessRemoteOwnership({ repoRoot: cwd });

  // Reporte redactado (cantidad/edad/owner/estado, sin contenido sensible).
  const summary = exceptionsPolicy.reportExceptions(list);

  const exitCode = invalid.length > 0 ? 1 : 0;
  const payload = {
    ...base,
    target: "exception",
    file,
    valid: invalid.length === 0,
    summary,
    results,
    remoteOwnership: ownership,
  };

  let serialized;
  try {
    serialized = safeSerialize(payload);
  } catch (err) {
    stderr.write(`redacción insuficiente, publicación bloqueada: ${err.message}\n`);
    printJson(stdout, { ...base, target: "exception", ok: false, error: "REDACTION_FAILED" });
    return 1;
  }

  if (invalid.length > 0) {
    stderr.write(`${invalid.length} excepción(es) inválida(s) bajo gobernanza\n`);
  }
  stdout.write(serialized.json + "\n");
  return exitCode;
}

/**
 * Lee la baseline temporal de deuda conocida desde `--baseline-file=<ruta>` o
 * desde el default administrado `.kiritek/baseline.json`. Devuelve `[]` si no
 * existe. Nunca evalúa el contenido como shell; sólo lo lee como texto/JSON.
 */
function readBaseline(flags, cwd) {
  const file =
    typeof flags.file === "string" && flags.file.trim() !== ""
      ? flags.file
      : require("path").join(cwd, ".kiritek", "baseline.json");
  if (!fs.existsSync(file)) return { file, baseline: [] };
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const baseline = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.baseline)
    ? parsed.baseline
    : [];
  return { file, baseline };
}

/**
 * Arma el probe de Jira para doctor/promote (observación remota). Igual que en
 * `security audit`: sólo si Jira está habilitado y no estamos offline; el
 * transporte es inyectable para pruebas. Nunca abre red por sí mismo.
 */
function jiraProbeFor(resolved, flags, deps) {
  const config = resolved.config;
  const jiraEnabled = config && config.jira && config.jira.enabled === true;
  if (!jiraEnabled || flags.offline) return undefined;
  return (deps && deps.jiraTransport) || jira.createRestTransport();
}

/**
 * Ejecuta `security doctor`: diagnóstico de readiness para promover. Reutiliza
 * la auditoría profunda + gobernanza de excepciones + baseline temporal.
 *
 * Exit codes coherentes (requisito 20): 0 ready; 1 not-ready (bloqueos reales);
 * 3 unknown (no verificable). La salida JSON cruza el redactor obligatorio.
 *
 * @returns {Promise<number>} exit code
 */
function runSecurityDoctor(ctx) {
  const { base, resolved, flags, cwd, env, stdout, stderr, deps } = ctx;

  let baseline;
  try {
    baseline = readBaseline(flags, cwd).baseline;
  } catch (err) {
    stderr.write(`no se pudo leer la baseline: ${err.message}\n`);
    printJson(stdout, { ...base, target: "doctor", ok: false, error: "BASELINE_READ_ERROR" });
    return 2;
  }

  return promotion
    .runDoctor(cwd, {
      config: resolved.config,
      env,
      deep: flags.deep === true,
      offline: flags.offline === true,
      jiraProbe: jiraProbeFor(resolved, flags, deps),
      selfCheckDeps: (deps && deps.selfCheckDeps) || {},
      baseline,
      auditFn: deps && deps.auditFn,
      now: deps && deps.now ? () => new Date(deps.now()).toISOString() : undefined,
    })
    .then(
      (doctor) => {
        const exitCode =
          doctor.readiness === promotion.READINESS.READY
            ? 0
            : doctor.readiness === promotion.READINESS.NOT_READY
            ? 1
            : 3;
        const payload = { ...base, target: "doctor", readiness: doctor.readiness, doctor };
        let serialized;
        try {
          serialized = safeSerialize(payload);
        } catch (err) {
          stderr.write(`redacción insuficiente en doctor; publicación bloqueada: ${err.message}\n`);
          printJson(stdout, { ...base, target: "doctor", ok: false, error: "REDACTION_FAILED" });
          return 1;
        }
        if (doctor.blockers.length > 0) {
          stderr.write(`readiness: ${doctor.readiness}; bloqueos: ${doctor.blockers.join("; ")}\n`);
        } else {
          stderr.write(`readiness: ${doctor.readiness}\n`);
        }
        if (doctor.baseline.expiringSoon.length > 0) {
          stderr.write(`aviso: ${doctor.baseline.expiringSoon.length} entrada(s) de baseline por expirar\n`);
        }
        stdout.write(serialized.json + "\n");
        return exitCode;
      },
      (err) => {
        stderr.write(`error ejecutando doctor: ${err.message}\n`);
        printJson(stdout, { ...base, target: "doctor", ok: false, error: "DOCTOR_RUN_ERROR" });
        return 1;
      }
    );
}

/**
 * Ejecuta `security promote --to=enforce`: PREVALIDA readiness (gate) y, sólo si
 * pasa (o con un override gobernado explícito sobre un readiness no verificable),
 * cambia el modo a `enforce` en la config de proyecto, registra la promoción
 * (actor/origen/fecha/config anterior-nueva/evidencia) y persiste el registro.
 *
 * Rechaza promover si readiness falla por bloqueos reales. Un override NO es un
 * bypass: exige `--override-actor` y `--override-reason`, queda registrado y sólo
 * aplica sobre `unknown` (no verificable), nunca sobre una falla demostrada.
 *
 * Exit codes: 0 promovido; 1 readiness insuficiente (no promueve); 2 uso
 * incorrecto. La salida cruza el redactor obligatorio.
 *
 * @returns {Promise<number>} exit code
 */
function runSecurityPromote(ctx) {
  const { base, resolved, flags, cwd, env, stdout, stderr, deps } = ctx;

  const to = typeof flags.to === "string" ? flags.to : null;
  if (to !== "enforce") {
    stderr.write("security promote requiere --to=enforce\n");
    printJson(stdout, { ...base, target: "promote", ok: false, error: "INVALID_TARGET_MODE", to });
    return 2;
  }

  let baselineRead;
  try {
    baselineRead = readBaseline(flags, cwd);
  } catch (err) {
    stderr.write(`no se pudo leer la baseline: ${err.message}\n`);
    printJson(stdout, { ...base, target: "promote", ok: false, error: "BASELINE_READ_ERROR" });
    return 2;
  }

  return promotion
    .runDoctor(cwd, {
      config: resolved.config,
      env,
      deep: flags.deep === true,
      offline: flags.offline === true,
      jiraProbe: jiraProbeFor(resolved, flags, deps),
      selfCheckDeps: (deps && deps.selfCheckDeps) || {},
      baseline: baselineRead.baseline,
      auditFn: deps && deps.auditFn,
      now: deps && deps.now ? () => new Date(deps.now()).toISOString() : undefined,
    })
    .then((doctor) => {
      // Override gobernado (NO bypass): actor + razón explícitos.
      const override =
        isNonEmptyFlag(flags["override-actor"]) && isNonEmptyFlag(flags["override-reason"])
          ? { actor: flags["override-actor"], reason: flags["override-reason"] }
          : undefined;
      const gate = promotion.canPromote(doctor, { override });

      if (!gate.allowed) {
        stderr.write(`promoción rechazada: ${gate.reason}\n`);
        if (doctor.blockers.length > 0) {
          stderr.write(`bloqueos: ${doctor.blockers.join("; ")}\n`);
        }
        const payload = {
          ...base,
          target: "promote",
          promoted: false,
          readiness: doctor.readiness,
          reason: gate.reason,
          blockers: doctor.blockers,
          doctor,
        };
        let serialized;
        try {
          serialized = safeSerialize(payload);
        } catch (err) {
          printJson(stdout, { ...base, target: "promote", ok: false, error: "REDACTION_FAILED" });
          return 1;
        }
        stdout.write(serialized.json + "\n");
        return 1;
      }

      // Readiness suficiente: construir registro y aplicar el cambio de modo.
      const previousConfig = loadRawProjectConfig(cwd) || { version: 1, mode: resolved.config.mode };
      const built = promotion.buildPromotionRecord(
        {
          actor: isNonEmptyFlag(flags["override-actor"]) ? flags["override-actor"] : actorFromEnv(env),
          origin: "cli",
          previousConfig,
          doctor,
          override: { overridden: gate.overridden, reason: gate.reason },
          baseline: baselineRead.baseline,
        },
        { clock: deps && deps.now ? () => new Date(deps.now()).toISOString() : undefined, toolVersion: VERSION }
      );

      const payload = {
        ...base,
        target: "promote",
        promoted: !flags["dry-run"],
        dryRun: !!flags["dry-run"],
        overridden: gate.overridden,
        readiness: doctor.readiness,
        record: built.record,
        evidence: { ...built.evidence },
        expiringSoon: doctor.baseline.expiringSoon,
      };

      let serialized;
      try {
        serialized = safeSerialize(payload);
      } catch (err) {
        stderr.write(`redacción insuficiente en promote; publicación bloqueada: ${err.message}\n`);
        printJson(stdout, { ...base, target: "promote", ok: false, error: "REDACTION_FAILED" });
        return 1;
      }

      // Aplicar el cambio de modo y persistir el registro (salvo --dry-run).
      if (!flags["dry-run"]) {
        try {
          applyPromotion(cwd, previousConfig, built.record);
        } catch (err) {
          stderr.write(`no se pudo aplicar la promoción: ${err.message}\n`);
          printJson(stdout, { ...base, target: "promote", ok: false, error: "PROMOTE_WRITE_ERROR" });
          return 1;
        }
      }

      if (gate.overridden) stderr.write(`promoción con override gobernado: ${gate.reason}\n`);
      if (doctor.baseline.expiringSoon.length > 0) {
        stderr.write(`aviso: ${doctor.baseline.expiringSoon.length} entrada(s) de baseline por expirar\n`);
      }
      stderr.write(`modo promovido a enforce${flags["dry-run"] ? " (dry-run, sin escribir)" : ""}\n`);
      stdout.write(serialized.json + "\n");
      return 0;
    }, (err) => {
      stderr.write(`error ejecutando promote: ${err.message}\n`);
      printJson(stdout, { ...base, target: "promote", ok: false, error: "PROMOTE_RUN_ERROR" });
      return 1;
    });
}

/** ¿El flag es un string no vacío? */
function isNonEmptyFlag(v) {
  return typeof v === "string" && v.trim() !== "";
}

/** Actor derivado del entorno sin imprimir credenciales (best-effort). */
function actorFromEnv(env) {
  const candidate = env && (env.KIRITEK_ACTOR || env.GITHUB_ACTOR || env.USER || env.USERNAME);
  return isNonEmptyFlag(candidate) ? candidate : "unknown";
}

/** Lee la config de proyecto CRUDA (sin resolver precedencia). null si ausente. */
function loadRawProjectConfig(cwd) {
  const file = require("path").join(cwd, "kiritek-security.config.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") delete parsed.$schema;
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * Aplica la promoción: escribe la config con `mode: enforce` y persiste el
 * registro de promoción bajo `.kiritek/promotions/`. Escritura atómica simple
 * (temporal + rename) y restringida al repo.
 */
function applyPromotion(cwd, previousConfig, record) {
  const path = require("path");
  const configFile = path.join(cwd, "kiritek-security.config.json");
  const newConfig = { ...(previousConfig || {}), mode: "enforce" };
  if (!newConfig.version) newConfig.version = 1;
  writeFileAtomic(configFile, JSON.stringify(newConfig, null, 2) + "\n");

  const dir = path.join(cwd, ".kiritek", "promotions");
  fs.mkdirSync(dir, { recursive: true });
  const safe = record.date.replace(/[:.]/g, "-");
  const recordFile = path.join(dir, `promotion-${safe}.json`);
  // El registro ya está pensado para cruzar el redactor; lo serializamos seguro.
  writeFileAtomic(recordFile, safeSerialize(record).json + "\n");
}

/**
 * Ejecuta `provider plan github|aws-codecommit`: genera un plan de provider
 * DESCRITO (dry-run), determinista y schema-válido. El plan NUNCA muta estado
 * remoto ni ejecuta una llamada mutante: cualquier apply requiere confirmación
 * humana explícita fuera del plan (16.1, 17.1, 22.6, G.9).
 *
 * Determinismo: el reloj y el generador de ids son INYECTABLES
 * (`deps.now`/`deps.idGenerator`); en producción usan valores reales. La salida
 * cruza el redactor obligatorio antes de stdout; las credenciales se leen SÓLO
 * del entorno y jamás se imprimen (sólo su presencia).
 *
 * @returns {number} exit code: 0 ok, 2 uso incorrecto.
 */
function runProviderPlan(ctx) {
  const { base, resolved, subcommand, positionals, env, stdout, stderr, deps } = ctx;
  const providers = require("./providers/index.js");

  if (subcommand !== "plan") {
    stderr.write("provider requiere el subcomando: plan\n");
    printJson(stdout, { ...base, ok: false, error: "INVALID_SUBCOMMAND", subcommand: subcommand || null });
    return 2;
  }

  const which = positionals[0];
  if (!providers.SUPPORTED.includes(which)) {
    stderr.write(`provider plan requiere ${providers.SUPPORTED.join("|")}\n`);
    printJson(stdout, { ...base, ok: false, error: "INVALID_PROVIDER", provider: which || null });
    return 2;
  }

  // Clock/idGenerator inyectables → mismo input produce un plan byte-idéntico.
  const clock =
    deps && deps.now
      ? () => new Date(deps.now()).toISOString()
      : () => new Date().toISOString();
  const idGenerator =
    deps && deps.idGenerator ? deps.idGenerator : () => `plan-${which}-${hashConfig(resolved.config)}`;

  let plan;
  try {
    plan = providers.createPlan(
      which,
      { env, config: resolved.config },
      { clock, idGenerator }
    );
  } catch (err) {
    stderr.write(`no se pudo generar el plan de provider: ${err.message}\n`);
    printJson(stdout, { ...base, ok: false, error: err.code || "PROVIDER_PLAN_ERROR", message: err.message });
    return 2;
  }

  const payload = { ...base, provider: which, plan };

  // Redacción obligatoria (fail-closed): si quedara un canario, se bloquea.
  let serialized;
  try {
    serialized = safeSerialize(payload);
  } catch (err) {
    stderr.write(`redacción insuficiente, publicación bloqueada: ${err.message}\n`);
    printJson(stdout, { ...base, ok: false, error: "REDACTION_FAILED" });
    return 2;
  }

  stdout.write(serialized.json + "\n");
  return 0;
}

/** Escritura atómica: temporal en el mismo dir + rename. */
function writeFileAtomic(target, content) {
  const path = require("path");
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.renameSync(tmp, target);
}

/** Hash estable y corto de la config efectiva (sin secretos: la config no los tiene). */
function hashConfig(config) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}

/**
 * Punto de entrada: parsea argv y ejecuta.
 */
function run(argv, deps = {}) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (err) {
    const stderr = deps.stderr || process.stderr;
    const stdout = deps.stdout || process.stdout;
    stderr.write(`${err.message}\n`);
    stdout.write(JSON.stringify({ ok: false, error: err.code || "CLI_ERROR", message: err.message }) + "\n");
    return 2;
  }
  return runParsed(parsed, deps);
}

/**
 * Variante asíncrona: siempre resuelve a un exit code numérico, incluso para
 * los comandos que hacen E/S de red (p. ej. `validate push` con Jira). Los
 * comandos síncronos resuelven de inmediato.
 */
async function runAsync(argv, deps = {}) {
  return run(argv, deps);
}

module.exports = { run, runAsync, runParsed, SECURITY_COMMANDS, helpText, VERSION };
