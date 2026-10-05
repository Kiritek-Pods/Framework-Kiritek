"use strict";

const { detectStacks, KNOWN_STACKS } = require("./detect.js");
const { confirmStacks, confirm, closePrompts } = require("./prompts.js");
const installer = require("./installer.js");
const { runAudit, appendComplianceLog, sendMetricsReport } = require("./audit.js");
const { installCore } = require("./install/core-security.js");

function parseArgs(argv) {
  const [command = "init", ...rest] = argv;
  const flags = {};
  for (const arg of rest) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) flags[match[1]] = match[2];
  }
  return { command, flags };
}

function report(label, { copied, skipped }) {
  if (copied.length) console.log(`  ${label}: instalado ${copied.length} archivo(s)`);
  for (const f of skipped) console.log(`  ${label}: ya existe, no se sobreescribe -> ${f}`);
}

async function cmdInit(flags, cwd) {
  const stacks = flags.stack
    ? flags.stack.split(",").map((s) => s.trim()).filter((s) => KNOWN_STACKS.includes(s))
    : await confirmStacks(detectStacks(cwd), KNOWN_STACKS);

  const wantsJira =
    flags.jira !== undefined
      ? flags.jira === "true"
      : await confirm(
          "¿Instalar integración con Jira (skill mcp-jira)? Requiere el servidor MCP oficial de Atlassian conectado."
        );

  console.log("\nInstalando Kiritek Framework...\n");

  report("core", installer.copyCore(cwd));
  for (const stack of stacks) {
    report(`stack:${stack}`, installer.copyStack(stack, cwd));
  }
  if (wantsJira) {
    report("mcp-jira", installer.copyOptional("mcp-jira", cwd));
  }
  report("docs", installer.renderProjectDocs(cwd, stacks, { jiraInstalled: wantsJira }));

  // Pack de seguridad integral (core/security). Se instala por defecto, es
  // NO destructivo y transaccional. Se puede omitir con `--security=off`
  // (deja constancia honesta de que las protecciones no quedaron activas).
  if (flags.security === "off") {
    console.log("\n  security: OMITIDO por --security=off (protecciones no instaladas)");
  } else {
    try {
      const sec = installCore({ repoRoot: cwd });
      const caps = (sec.capabilities || [])
        .map((c) => `${c.id}:${c.status}`)
        .join(", ");
      console.log(`\n  security: pack instalado (${sec.projectType || "?"}, modo ${sec.mode}) -> ${caps}`);
      if (sec.hooks && sec.hooks.strategy === "manual") {
        console.log(`  security: hooks Git requieren integración manual (${sec.hooks.reason || "gestor de terceros"})`);
      } else if (sec.hooks && sec.hooks.applied) {
        console.log(`  security: hooks Git instalados -> ${(sec.hooks.installed || []).join(", ")}`);
      }
      const conflicts = sec.reconcile && sec.reconcile.conflicts ? sec.reconcile.conflicts : [];
      if (conflicts.length) {
        console.log(`  security: conflictos (propuestas .kiritek-new): ${conflicts.join(", ")}`);
      }
    } catch (err) {
      console.warn(`  security: no se pudo instalar el pack (${err.message}). Córrelo luego con \`kiritek-init security install\`.`);
    }
  }

  console.log("\nSpec Kit (github/spec-kit oficial — flujo de spec-driven development):");
  try {
    if (!installer.commandExists("uvx") && !installer.commandExists("uv")) {
      const wantsUv = await confirm(
        "  spec-kit: necesita `uv` y no está instalado. ¿Instalarlo ahora con `curl -LsSf https://astral.sh/uv/install.sh | sh`?"
      );
      if (!wantsUv) {
        throw new Error(
          "uv no instalado — instálalo manualmente y vuelve a correr `kiritek-init` o `uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude`."
        );
      }
      installer.installUv();
    }
    installer.setupSpecKit(cwd).forEach((line) => console.log(`  spec-kit: ${line}`));
  } catch (err) {
    console.warn(
      `  spec-kit: falló la instalación automática (${err.message}). Instálalo manualmente: uvx --from git+https://github.com/github/spec-kit.git specify init --here --integration claude`
    );
  }

  const wantsGraphify = await confirm("\n¿Instalar/configurar Graphify (indexado de código)?");
  if (wantsGraphify) {
    try {
      if (!installer.commandExists("graphify") && !installer.commandExists("uv")) {
        const wantsUv = await confirm(
          "  graphify: necesita `uv` y no está instalado. ¿Instalarlo ahora con `curl -LsSf https://astral.sh/uv/install.sh | sh`?"
        );
        if (!wantsUv) {
          throw new Error("uv no instalado — instálalo manualmente y vuelve a correr `kiritek-init` o `graphify install`.");
        }
        installer.installUv();
      }
      installer.setupGraphify(cwd).forEach((line) => console.log(`  graphify: ${line}`));
    } catch (err) {
      console.warn(`  graphify: falló la instalación automática (${err.message}). Instálalo manualmente.`);
    }
  }

  console.log("\nclaude-mem-lite:");
  installer.claudeMemLiteInstructions().forEach((line) => console.log(`  ${line}`));

  console.log(`\nListo. Stacks instalados: ${stacks.length ? stacks.join(", ") : "(solo core)"}`);
}

async function cmdAudit(flags, cwd) {
  const result = runAudit(cwd);
  const logPath = appendComplianceLog(cwd, result);
  for (const r of result.results) {
    console.log(`  ${r.pass ? "✅" : "❌"} ${r.name}`);
  }
  console.log(`\nEstado: ${result.ok ? "cumple" : "incompleto"}. Registrado en ${logPath}`);

  const webhookUrl = flags.webhook || process.env.KIRITEK_METRICS_WEBHOOK;
  if (webhookUrl) {
    const report = await sendMetricsReport(webhookUrl, cwd, result);
    console.log(
      report.ok
        ? "  métricas: enviadas al reporte central"
        : `  métricas: no se pudieron enviar (${report.error}) — auditoría local sigue válida`
    );
  }

  if (!result.ok) process.exitCode = 1;
}

async function cmdUpdate(flags, cwd) {
  console.log("Actualizando templates (no sobreescribe personalizaciones existentes)...\n");
  await cmdInit({ ...flags, _isUpdate: true }, cwd);
}

// Comandos del core de seguridad enrutados al nuevo CLI tipado. Los comandos
// legacy (init/audit/update) conservan su comportamiento intacto.
const securityCli = require("./security-cli.js");
const SECURITY_COMMANDS = new Set(securityCli.SECURITY_COMMANDS);

async function run(argv) {
  const [command] = argv;
  const cwd = process.cwd();

  // Enrutar comandos de seguridad (scan, validate, security, provider,
  // uninstall) al router dedicado, que ya hace su propio parseo tipado.
  if (SECURITY_COMMANDS.has(command)) {
    // El router puede devolver un número (comandos síncronos) o una promesa
    // (p. ej. `validate push`, que valida Jira remotamente). Se normaliza.
    const code = await securityCli.run(argv, { cwd, env: process.env });
    if (code) process.exitCode = code;
    return;
  }

  const { command: legacyCommand, flags } = parseArgs(argv);

  try {
    switch (legacyCommand) {
      case "init":
        return await cmdInit(flags, cwd);
      case "audit":
        return await cmdAudit(flags, cwd);
      case "update":
        return await cmdUpdate(flags, cwd);
      default:
        console.error(`Comando desconocido: ${legacyCommand}`);
        console.error(
          "Uso: npx kiritek-init [init|audit|update] [--stack=java-spring,flutter]\n" +
            "     kiritek-init [scan|validate|security|provider|uninstall] (seguridad)"
        );
        process.exitCode = 1;
    }
  } finally {
    closePrompts();
  }
}

module.exports = { run, parseArgs };
