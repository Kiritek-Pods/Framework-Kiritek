"use strict";

/**
 * Parser de argumentos tipado para el CLI de Kiritek.
 *
 * Reemplaza el parser manual previo (que sólo aceptaba `--k=v` y descartaba el
 * resto en silencio). Este:
 *  - reconoce subcomandos de una o dos palabras (`init`, `security doctor`);
 *  - soporta flags booleanos (`--dry-run`), con valor (`--mode=enforce` o
 *    `--mode enforce`) y negados (`--no-telemetry`);
 *  - rechaza flags desconocidos en vez de ignorarlos (requisito 22.8);
 *  - no evalúa nada: sólo estructura la entrada.
 */

/** Comandos de dos palabras: su segundo token es un subcomando, no un flag. */
const TWO_WORD = Object.freeze({
  security: ["doctor", "promote", "exception", "install", "audit"],
  provider: ["plan"],
});

/**
 * Flags de tipo `value` que TAMBIÉN pueden usarse sin valor (como presencia).
 * Ej.: `uninstall --security` selecciona el pack de seguridad sin exigir un
 * valor; `--security=off` sigue funcionando. Mantener esta lista mínima evita
 * debilitar la validación estricta del resto de flags con valor.
 */
const BARE_OK = Object.freeze(["security"]);

/** Flags conocidos y su tipo. value = requiere valor; boolean = sin valor. */
const KNOWN_FLAGS = Object.freeze({
  help: "boolean",
  version: "boolean",
  "dry-run": "boolean",
  deep: "boolean",
  offline: "boolean",
  yes: "boolean",
  "non-interactive": "boolean",
  security: "value",
  mode: "value",
  "gitleaks-version": "value",
  "gitleaks-source": "value",
  "history-depth": "value",
  "default-branch": "value",
  "block-direct-push": "value",
  "force-policy": "value",
  commits: "value",
  jira: "value",
  "jira-key-pattern": "value",
  "message-file": "value",
  // Evento de hook (Claude/Kiro/pre-push) en archivo: lo usan los shims.
  "stdin-file": "value",
  message: "value",
  file: "value",
  branch: "value",
  "jira-fallback": "value",
  "jira-base-url": "value",
  event: "value",
  range: "value",
  remote: "value",
  provider: "value",
  assistants: "value",
  hooks: "value",
  ci: "value",
  "report-dir": "value",
  telemetry: "value",
  format: "value",
  stack: "value",
  scope: "value",
  to: "value",
  webhook: "value",
  "override-actor": "value",
  "override-reason": "value",
});

/** Flags booleanos que admiten la forma `--no-<flag>`. */
function isBooleanFlag(name) {
  return KNOWN_FLAGS[name] === "boolean" || KNOWN_FLAGS[name] === "value";
}

class CliError extends Error {
  constructor(message) {
    super(message);
    this.code = "CLI_PARSE_ERROR";
  }
}

/**
 * @param {string[]} argv  Argumentos sin `node` ni script.
 * @returns {{ command: string, subcommand: string|null, flags: object, positionals: string[] }}
 */
function parse(argv) {
  const tokens = Array.isArray(argv) ? [...argv] : [];
  const flags = {};
  const positionals = [];

  // Permitir --help/--version como primer token sin comando.
  let command = null;
  let subcommand = null;

  let i = 0;

  // Primer token no-flag es el comando.
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.startsWith("--")) break;
    command = t;
    i += 1;
    // ¿comando de dos palabras?
    if (TWO_WORD[command] && tokens[i] && !tokens[i].startsWith("--")) {
      const second = tokens[i];
      if (!TWO_WORD[command].includes(second)) {
        throw new CliError(`subcomando desconocido para "${command}": ${second}`);
      }
      subcommand = second;
      i += 1;
    }
    break;
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

    if (!Object.prototype.hasOwnProperty.call(KNOWN_FLAGS, name)) {
      throw new CliError(`flag desconocido: --${t.slice(2)}`);
    }

    const type = KNOWN_FLAGS[name];

    if (negated) {
      if (!isBooleanFlag(name)) throw new CliError(`--no-${name} no es válido`);
      flags[name] = false;
      continue;
    }

    if (type === "boolean") {
      if (value !== undefined) throw new CliError(`--${name} no acepta valor`);
      flags[name] = true;
      continue;
    }

    // type === value
    if (value === undefined) {
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith("--")) {
        // Un flag de valor en la lista BARE_OK puede usarse como presencia.
        if (BARE_OK.includes(name)) {
          flags[name] = true;
          continue;
        }
        throw new CliError(`--${name} requiere un valor`);
      }
      value = next;
      i += 1;
    }
    flags[name] = value;
  }

  return { command, subcommand, flags, positionals };
}

module.exports = { parse, CliError, KNOWN_FLAGS, TWO_WORD, BARE_OK };
