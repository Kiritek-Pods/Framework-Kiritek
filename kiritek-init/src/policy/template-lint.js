"use strict";

/**
 * Linter de plantillas de PR/ticket (Requisitos 18.1–18.3).
 *
 * Verifica dos cosas sobre el texto de una plantilla:
 *
 *  1. Que NO solicite datos sensibles: secretos, tokens, credenciales, dumps,
 *     prompts completos ni logs sin redactar. Esta regla es independiente del
 *     proveedor y se aplica también a plantillas editadas por packs.
 *  2. Que las secciones de nivel superior (encabezados `## `) estén dentro del
 *     conjunto permitido para ese tipo de plantilla, sin campos extra.
 *
 * El linter opera sobre texto, no muta nada, y devuelve violaciones legibles.
 */

// Conjuntos de secciones permitidas por tipo de plantilla (orden no impuesto;
// se compara por pertenencia). Deben coincidir con los encabezados `## ` de
// `templates/core/security/templates/*.md`.
const ALLOWED_SECTIONS = Object.freeze({
  pr: Object.freeze([
    "Ticket",
    "Resumen y riesgo",
    "Evidencia de pruebas y seguridad",
    "Impacto en secretos y datos",
    "Plan de rollback",
  ]),
  ticket: Object.freeze([
    "Objetivo",
    "Criterios de aceptación",
    "Riesgo y datos",
    "Dependencias",
    "Evidencia requerida",
  ]),
});

/**
 * Patrones que indican una PETICIÓN de datos sensibles. Buscamos verbos de
 * solicitud ("pega", "incluye", "adjunta", "copia", "proporciona", "paste",
 * "attach", "provide", "include") seguidos de un objeto sensible, o menciones
 * directas de "log sin redactar" / "logs crudos" / "dump".
 *
 * Importante: distinguimos SOLICITAR de PROHIBIR. Las plantillas contienen
 * instrucciones que dicen "NO pegues secretos"; esas no deben contar como
 * violación. Por eso cada patrón de solicitud exige que no venga precedido de
 * una negación cercana.
 */
const REQUEST_VERBS = "(?:pega|pegues|pegar|incluye|incluir|adjunta|adjuntar|copia|copiar|proporciona|proporcionar|comparte|compartir|paste|attach|provide|include|share|dump)";
const SENSITIVE_OBJECTS = "(?:secreto|secretos|secret|secrets|token|tokens|credencial|credenciales|credential|credentials|password|contraseña|api[_\\s-]?key|clave\\s+privada|private\\s+key|prompt completo|prompts completos|full prompt)";

// Menciones que son violación por sí mismas (pedir el dato), salvo negación.
const SELF_SENSITIVE = [
  { id: "unredacted-log", re: /\blogs?\s+(?:sin\s+redactar|crudos?|raw|completos?)\b/i },
  { id: "db-dump", re: /\b(?:dump\s+de\s+(?:base\s+de\s+datos|bd|db)|database\s+dump|db\s+dump)\b/i },
];

const REQUEST_RE = new RegExp(`${REQUEST_VERBS}[^.\\n]{0,40}?${SENSITIVE_OBJECTS}`, "i");

// Negaciones que, si aparecen en la línea, convierten una mención en prohibición
// (permitida), no en solicitud. Nota: NO se incluye "sin" porque colisiona con
// expresiones como "logs sin redactar", que SÍ son una violación.
const NEGATION_RE = /\b(no|nunca|never|don't|do not|evita|evitar)\b/i;

function stripHtmlComments(text) {
  // Mantiene el contenido de los comentarios (ahí viven las instrucciones),
  // sólo retira los delimitadores para analizar como una sola superficie.
  return text.replace(/<!--/g, " ").replace(/-->/g, " ");
}

/**
 * Agrupa el texto en unidades lógicas de análisis. Una línea que es
 * continuación de prosa (no empieza encabezado `#`, viñeta `-`, ni está vacía)
 * se une a la unidad previa. Así una frase que ocupa varias líneas se evalúa
 * completa (negación incluida) y no se fragmenta artificialmente.
 */
function toLogicalUnits(text) {
  const units = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const startsNew = /^(#{1,6}\s|[-*]\s|\d+\.\s)/.test(line);
    if (startsNew || units.length === 0) {
      units.push(line);
    } else {
      units[units.length - 1] += " " + line;
    }
  }
  return units;
}

function topLevelSections(text) {
  const sections = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) sections.push(m[1]);
  }
  return sections;
}

/**
 * Analiza una línea lógica buscando solicitudes de datos sensibles.
 * @returns {string[]} ids de violación encontrados en la línea.
 */
function scanLineForSensitiveRequests(line) {
  const hits = [];
  const negated = NEGATION_RE.test(line);

  if (REQUEST_RE.test(line) && !negated) {
    hits.push("request-sensitive");
  }
  for (const { id, re } of SELF_SENSITIVE) {
    if (re.test(line) && !negated) {
      hits.push(id);
    }
  }
  return hits;
}

/**
 * Linta una plantilla.
 *
 * @param {string} text  Contenido de la plantilla.
 * @param {object} [opts]
 * @param {"pr"|"ticket"} [opts.kind]  Si se indica, valida las secciones permitidas.
 * @returns {{ ok: boolean, violations: Array<{code: string, detail: string}> }}
 */
function lintTemplate(text, opts = {}) {
  const violations = [];
  if (typeof text !== "string") {
    return { ok: false, violations: [{ code: "invalid-input", detail: "texto ausente" }] };
  }

  const surface = stripHtmlComments(text);

  // 1) No solicitar datos sensibles. Analizamos por "unidad de sentido": las
  //    líneas que no comienzan una nueva sección/viñeta se unen a la anterior,
  //    de modo que una prohibición que envuelve varias líneas ("NO pegues ...
  //    ni logs sin redactar") se evalúe como una sola frase y no se parta.
  for (const unit of toLogicalUnits(surface)) {
    for (const hit of scanLineForSensitiveRequests(unit)) {
      violations.push({ code: hit, detail: unit.trim().slice(0, 120) });
    }
  }

  // 2) Secciones permitidas (sólo si se declara el tipo).
  if (opts.kind) {
    const allowed = ALLOWED_SECTIONS[opts.kind];
    if (!allowed) {
      violations.push({ code: "unknown-kind", detail: String(opts.kind) });
    } else {
      const sections = topLevelSections(text);
      for (const s of sections) {
        if (!allowed.includes(s)) {
          violations.push({ code: "unexpected-section", detail: s });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
  ALLOWED_SECTIONS,
  lintTemplate,
  scanLineForSensitiveRequests,
  toLogicalUnits,
  topLevelSections,
};
