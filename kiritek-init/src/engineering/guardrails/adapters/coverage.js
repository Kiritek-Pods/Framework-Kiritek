"use strict";

/**
 * Cobertura por superficie (T14.7, R12.6, R13.4). Declara qué intercepta
 * cada superficie, qué NO puede interceptar y qué superficie posterior lo
 * cubre. Nunca atribuye protección inexistente: lo no interceptable se
 * reporta `unavailable` con cobertura en Git/CI.
 */

const SURFACES = Object.freeze({
  kiro: {
    moment: "agent",
    intercepts: ["fs_write", "write", "str_replace"],
    notInterceptable: [
      { operation: "execute_bash/shell (escrituras indirectas por comando)", coveredBy: ["pre-commit", "pr"] },
      { operation: "use_aws / herramientas MCP", coveredBy: ["pr"] },
      { operation: "ediciones fuera del agente (IDE, otras herramientas)", coveredBy: ["pre-commit", "pr"] },
    ],
  },
  claude: {
    moment: "agent",
    intercepts: ["Edit", "Write", "MultiEdit", "NotebookEdit"],
    notInterceptable: [
      { operation: "Bash (escrituras indirectas por comando)", coveredBy: ["pre-commit", "pr"] },
      { operation: "herramientas MCP (mcp__*)", coveredBy: ["pr"] },
      { operation: "ediciones fuera del agente (IDE, otras herramientas)", coveredBy: ["pre-commit", "pr"] },
    ],
  },
  "git-pre-commit": {
    moment: "pre-commit",
    intercepts: ["contenido staged"],
    notInterceptable: [
      { operation: "git commit --no-verify / hooks deshabilitados", coveredBy: ["pr"] },
      { operation: "tests conductuales (diferidos por presupuesto)", coveredBy: ["pr", "release"] },
    ],
  },
  ci: { moment: "pr", intercepts: ["rango base..head completo"], notInterceptable: [{ operation: "push directo sin PR / sin branch protection", coveredBy: ["release"] }] },
  release: { moment: "release", intercepts: ["artefacto/config candidata"], notInterceptable: [] },
});

/**
 * Matriz control × superficie: `covered` si el catálogo declara el momento;
 * si no, `pending` con la superficie posterior que lo cubre (no se simula).
 */
function coverageMatrix(catalog) {
  const rows = [];
  for (const control of catalog.controls) {
    const moments = control.moments.map((m) => m.moment);
    for (const [surface, s] of Object.entries(SURFACES)) {
      const covered = moments.includes(s.moment);
      rows.push({
        controlId: control.id,
        surface,
        moment: s.moment,
        status: covered ? "covered" : "pending",
        ...(covered ? {} : { coveredBy: moments.filter((m) => ["pr", "release"].includes(m)) }),
      });
    }
  }
  return {
    rows,
    notInterceptable: Object.entries(SURFACES).flatMap(([surface, s]) => s.notInterceptable.map((n) => ({ surface, status: "unavailable", ...n }))),
  };
}

module.exports = { SURFACES, coverageMatrix };
