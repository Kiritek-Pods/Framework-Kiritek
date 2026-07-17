"use strict";

const { detectStacks, KNOWN_STACKS } = require("./detect.js");
const { confirmStacks, confirm } = require("./prompts.js");
const installer = require("./installer.js");
const { runAudit, appendComplianceLog } = require("./audit.js");

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

  console.log("\nInstalando Kiritek Framework...\n");

  report("core", installer.copyCore(cwd));
  for (const stack of stacks) {
    report(`stack:${stack}`, installer.copyStack(stack, cwd));
  }
  report("docs", installer.renderProjectDocs(cwd, stacks));

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
  if (!result.ok) process.exitCode = 1;
}

async function cmdUpdate(flags, cwd) {
  console.log("Actualizando templates (no sobreescribe personalizaciones existentes)...\n");
  await cmdInit({ ...flags, _isUpdate: true }, cwd);
}

async function run(argv) {
  const { command, flags } = parseArgs(argv);
  const cwd = process.cwd();

  switch (command) {
    case "init":
      return cmdInit(flags, cwd);
    case "audit":
      return cmdAudit(flags, cwd);
    case "update":
      return cmdUpdate(flags, cwd);
    default:
      console.error(`Comando desconocido: ${command}`);
      console.error("Uso: npx kiritek-init [init|audit|update] [--stack=java-spring,flutter]");
      process.exitCode = 1;
  }
}

module.exports = { run, parseArgs };
