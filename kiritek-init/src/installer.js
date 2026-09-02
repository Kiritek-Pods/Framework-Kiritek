"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

/**
 * Copia srcDir -> destDir recursivamente. Si un archivo destino ya existe,
 * NO lo sobreescribe (regla: "no sobreescribe sin avisar") y lo reporta.
 * @returns {{copied: string[], skipped: string[]}}
 */
function mergeCopyDir(srcDir, destDir) {
  const copied = [];
  const skipped = [];

  function walk(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath, destPath);
      } else if (fs.existsSync(destPath)) {
        skipped.push(path.relative(process.cwd(), destPath));
      } else {
        fs.copyFileSync(srcPath, destPath);
        copied.push(path.relative(process.cwd(), destPath));
      }
    }
  }

  walk(srcDir, destDir);
  return { copied, skipped };
}

function copyCore(destDir) {
  const result = mergeCopyDir(path.join(TEMPLATES_DIR, "core", ".claude"), path.join(destDir, ".claude"));

  const graphifyignoreSrc = path.join(TEMPLATES_DIR, "core", ".graphifyignore");
  const graphifyignoreDest = path.join(destDir, ".graphifyignore");
  if (fs.existsSync(graphifyignoreDest)) {
    result.skipped.push(".graphifyignore");
  } else {
    fs.copyFileSync(graphifyignoreSrc, graphifyignoreDest);
    result.copied.push(".graphifyignore");
  }

  const auditConfigSrc = path.join(TEMPLATES_DIR, "core", "kiritek-audit.config.json");
  const auditConfigDest = path.join(destDir, "kiritek-audit.config.json");
  if (fs.existsSync(auditConfigDest)) {
    result.skipped.push("kiritek-audit.config.json");
  } else {
    fs.copyFileSync(auditConfigSrc, auditConfigDest);
    result.copied.push("kiritek-audit.config.json");
  }

  return result;
}

function copyStack(stackName, destDir) {
  const stackDir = path.join(TEMPLATES_DIR, "stacks", stackName, ".claude");
  if (!fs.existsSync(stackDir)) {
    throw new Error(`Stack desconocido: ${stackName}`);
  }
  return mergeCopyDir(stackDir, path.join(destDir, ".claude"));
}

function copyOptional(name, destDir) {
  const optionalDir = path.join(TEMPLATES_DIR, "optional", name, ".claude");
  if (!fs.existsSync(optionalDir)) {
    throw new Error(`Pieza opcional desconocida: ${name}`);
  }
  return mergeCopyDir(optionalDir, path.join(destDir, ".claude"));
}

function renderProjectDocs(destDir, stacks, { jiraInstalled = false } = {}) {
  const stackList = stacks.length > 0 ? stacks.join(", ") : "(ninguno detectado)";
  const jiraLine = jiraInstalled
    ? "- **Jira**: ver skill `mcp-jira` — traer ticket, confirmar entendido, branch/commit con clave del ticket, comentar al cerrar, nunca transicionar estado sin humano.\n"
    : "";
  const result = { copied: [], skipped: [] };

  for (const filename of ["CLAUDE.md", "AGENTS.md"]) {
    const destPath = path.join(destDir, filename);
    if (fs.existsSync(destPath)) {
      result.skipped.push(filename);
      continue;
    }
    const template = fs.readFileSync(path.join(TEMPLATES_DIR, "core", filename), "utf8");
    const rendered = template.replace("{{STACKS}}", stackList).replace("{{JIRA_LINE}}", jiraLine);
    fs.writeFileSync(destPath, rendered);
    result.copied.push(filename);
  }

  return result;
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function installUv() {
  execSync("curl -LsSf https://astral.sh/uv/install.sh | sh", { stdio: "inherit" });
  // El instalador agrega su bin al PATH del shell (rc file), pero este proceso
  // de node ya está corriendo y no lo ve hasta un shell nuevo — lo parcheamos
  // acá pa' que `uv` funcione en la misma corrida sin reiniciar la terminal.
  const candidateDirs = [
    path.join(require("os").homedir(), ".local", "bin"),
    path.join(require("os").homedir(), ".cargo", "bin"),
  ];
  for (const dir of candidateDirs) {
    if (fs.existsSync(path.join(dir, "uv")) && !process.env.PATH.includes(dir)) {
      process.env.PATH = `${dir}:${process.env.PATH}`;
    }
  }
}

function setupGraphify(destDir) {
  const log = [];
  if (!commandExists("graphify")) {
    log.push("graphify no encontrado, instalando con `uv tool install graphifyy`...");
    execSync("uv tool install graphifyy", { cwd: destDir, stdio: "inherit" });
  }
  log.push("corriendo `graphify install`...");
  execSync("graphify install", { cwd: destDir, stdio: "inherit" });
  log.push("corriendo `graphify claude install`...");
  execSync("graphify claude install", { cwd: destDir, stdio: "inherit" });
  return log;
}

function setupSpecKit(destDir) {
  const log = [];
  if (fs.existsSync(path.join(destDir, ".specify"))) {
    log.push("ya instalado (.specify/ existe), no se reinstala");
    return log;
  }
  log.push("corriendo `specify init` (github/spec-kit oficial) vía uvx...");
  execSync(
    "uvx --from git+https://github.com/github/spec-kit.git specify init --here --force --integration claude --non-interactive --script sh",
    { cwd: destDir, stdio: "inherit" }
  );
  return log;
}

function claudeMemLiteInstructions() {
  return [
    "claude-mem-lite no se instala automáticamente (requiere Linux/macOS, setup manual).",
    "Ver: https://github.com/sdsrss/claude-mem-lite",
  ];
}

module.exports = {
  mergeCopyDir,
  copyCore,
  copyStack,
  copyOptional,
  renderProjectDocs,
  setupGraphify,
  setupSpecKit,
  installUv,
  claudeMemLiteInstructions,
  commandExists,
};
