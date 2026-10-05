"use strict";

/**
 * Linter de endurecimiento para los workflows de GitHub Actions EMITIDOS por el
 * pack (tarea 39.6, requisito 17.4 / G.8). Es un analizador estático de texto
 * (sin dependencias YAML): comprueba las invariantes de seguridad que todo
 * template de Actions del pack debe cumplir.
 *
 * Reglas:
 *  - sha-pin:       cada `uses:` fija la action por SHA de 40 hex (nunca tag
 *                   mutable como @v4, @main, @latest).
 *  - permissions:   el workflow declara `permissions:` y usa `contents: read`
 *                   (lectura mínima; sin permisos amplios por defecto).
 *  - no-push:       no ejecuta `git push` ni `git commit` (push directo viola la
 *                   rama protegida y la política del pack).
 *  - fork-safe:     no usa `pull_request_target` haciendo checkout del código
 *                   del fork (vector de exfiltración de secretos). Si aparece
 *                   `pull_request_target`, se marca a menos que esté explícito
 *                   que no hace checkout del head del fork.
 *  - core-command:  invoca un comando core (`kiritek-init`), en vez de
 *                   reimplementar la detección.
 *  - timeout/concurrency: acota recursos.
 *
 * Devuelve { ok, violations:[{ code, message, line? }] }.
 */

const SHA40 = /^[0-9a-f]{40}$/;
const USES_LINE = /uses:\s+([\w.-]+\/[\w.-]+(?:\/[\w.-]+)?)@(\S+)/;

/** Quita comentarios de línea (`# ...`) para no analizar texto explicativo. */
function stripComments(content) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("#")) return "";
      return line;
    })
    .join("\n");
}

function lintWorkflow(content, opts = {}) {
  const requireCoreCommand = opts.requireCoreCommand !== false;
  const violations = [];
  const lines = content.split("\n");
  // Para las reglas basadas en contenido (no `uses:`), ignoramos comentarios:
  // mencionar `pull_request_target` o `git push` en un comentario explicativo
  // no es una violación; sólo lo es su uso real.
  const code = stripComments(content);

  // sha-pin
  const usesLines = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /uses:/.test(line));
  if (usesLines.length === 0) {
    violations.push({ code: "no-actions", message: "el workflow no usa ninguna action" });
  }
  for (const { line, i } of usesLines) {
    const m = line.match(USES_LINE);
    if (!m) {
      violations.push({ code: "uses-unparseable", message: `línea uses sin referencia: ${line.trim()}`, line: i + 1 });
      continue;
    }
    const ref = m[2];
    if (!SHA40.test(ref)) {
      violations.push({
        code: "sha-pin",
        message: `action no fijada por SHA de 40 hex (tag mutable): ${line.trim()}`,
        line: i + 1,
      });
    }
  }

  // permissions
  if (!/permissions:/.test(code)) {
    violations.push({ code: "permissions", message: "el workflow no declara 'permissions:'" });
  }
  if (!/contents:\s*read/.test(code)) {
    violations.push({ code: "permissions-min", message: "el workflow no usa 'contents: read' (permiso mínimo)" });
  }
  // Permisos amplios obvios: write-all o permissions: write-all.
  if (/permissions:\s*write-all/.test(code)) {
    violations.push({ code: "permissions-broad", message: "'permissions: write-all' es demasiado amplio" });
  }

  // no-push
  if (/git\s+push/.test(code)) {
    violations.push({ code: "no-push", message: "el workflow no debe hacer 'git push'" });
  }
  if (/git\s+commit/.test(code)) {
    violations.push({ code: "no-commit", message: "el workflow no debe hacer 'git commit'" });
  }

  // fork-safe: pull_request_target con checkout del head del fork es peligroso.
  if (/pull_request_target/.test(code)) {
    violations.push({
      code: "fork-unsafe",
      message:
        "usa 'pull_request_target' (expone secretos a PRs de forks); preferir 'pull_request'",
    });
  }

  // timeout / concurrency
  if (!/timeout-minutes:/.test(code)) {
    violations.push({ code: "timeout", message: "el workflow no declara 'timeout-minutes'" });
  }
  if (!/concurrency:/.test(code)) {
    violations.push({ code: "concurrency", message: "el workflow no declara 'concurrency'" });
  }

  // core-command
  if (requireCoreCommand && !/kiritek-init/.test(code)) {
    violations.push({
      code: "core-command",
      message: "el workflow debe invocar el comando core 'kiritek-init' (no reimplementar detección)",
    });
  }

  return { ok: violations.length === 0, violations };
}

module.exports = { lintWorkflow, SHA40, USES_LINE };
