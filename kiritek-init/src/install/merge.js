"use strict";

/**
 * Fusión administrada no destructiva de archivos compartidos.
 *
 * Tres estrategias:
 *  1. Bloque marcado (ignores y archivos de líneas): Kiritek administra un
 *     bloque delimitado por marcadores; el contenido del usuario fuera del
 *     bloque no se toca, reordena ni duplica.
 *  2. Merge estructurado conservador (JSON): sólo agrega claves que faltan;
 *     si una clave existe con otro valor, lo marca como conflicto y NO
 *     sobrescribe.
 *  3. Propuesta (`.kiritek-new`): para Markdown/scripts personalizados, nunca
 *     se sobrescribe el original; se deja una propuesta junto a un diff lógico.
 *
 * (Requisitos 13.1–13.2, 21.2–21.5, 21.10, 23.3, G.2.)
 */

const BEGIN = "# >>> kiritek-security (managed) >>>";
const END = "# <<< kiritek-security (managed) <<<";

/**
 * Detecta el fin de línea predominante del texto para no mezclar CRLF/LF.
 */
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}

function splitLines(text) {
  return text.length === 0 ? [] : text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Fusiona un bloque administrado de entradas en un archivo de líneas (ignore).
 *
 * - Si no hay bloque, lo añade al final preservando el contenido previo.
 * - Si ya hay bloque, reemplaza sólo su interior con las entradas deseadas.
 * - Dentro del bloque no se duplican entradas; si una entrada deseada ya existe
 *   fuera del bloque (puesta por el usuario), no se vuelve a añadir.
 *
 * @returns {{ content: string, changed: boolean }}
 */
function mergeManagedBlock(originalText, entries) {
  const text = typeof originalText === "string" ? originalText : "";
  const eol = detectEol(text);
  const lines = splitLines(text);

  const beginIdx = lines.indexOf(BEGIN);
  const endIdx = lines.indexOf(END);

  // Entradas del usuario fuera del bloque (para no duplicar).
  const outsideUser = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (i >= beginIdx && i <= endIdx && beginIdx !== -1 && endIdx !== -1) continue;
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("#")) outsideUser.add(trimmed);
  }

  const desired = [];
  const seen = new Set();
  for (const e of entries) {
    const entry = String(e).trim();
    if (!entry || seen.has(entry) || outsideUser.has(entry)) continue;
    seen.add(entry);
    desired.push(entry);
  }

  const block = [BEGIN, ...desired, END];

  let newLines;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Reemplazar interior del bloque existente.
    newLines = [...lines.slice(0, beginIdx), ...block, ...lines.slice(endIdx + 1)];
  } else {
    // Añadir bloque al final, con una línea en blanco de separación si hace falta.
    newLines = [...lines];
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "") newLines.push("");
    else if (newLines.length > 0 && newLines[newLines.length - 1] === "") {
      /* ya hay separación */
    }
    newLines.push(...block);
  }

  // Normalizar: una sola línea final.
  while (newLines.length > 1 && newLines[newLines.length - 1] === "") newLines.pop();
  const content = newLines.join(eol) + eol;
  return { content, changed: content !== text };
}

/**
 * Merge estructurado conservador de JSON: agrega sólo lo que falta.
 *
 * @returns {{ merged: object, conflicts: string[], changed: boolean }}
 */
function mergeJson(original, additions) {
  const conflicts = [];
  let changed = false;

  function merge(dst, src, prefix) {
    for (const [key, value] of Object.entries(src)) {
      const dotted = prefix ? `${prefix}.${key}` : key;
      if (!(key in dst)) {
        dst[key] = value;
        changed = true;
      } else if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        dst[key] &&
        typeof dst[key] === "object" &&
        !Array.isArray(dst[key])
      ) {
        merge(dst[key], value, dotted);
      } else if (JSON.stringify(dst[key]) !== JSON.stringify(value)) {
        conflicts.push(dotted); // existe con otro valor: no sobrescribir
      }
    }
  }

  const merged = JSON.parse(JSON.stringify(original || {}));
  merge(merged, additions || {}, "");
  return { merged, conflicts, changed };
}

/**
 * Genera el nombre de la propuesta junto al archivo original.
 */
function proposalPath(originalPath) {
  return `${originalPath}.kiritek-new`;
}

module.exports = {
  BEGIN,
  END,
  detectEol,
  mergeManagedBlock,
  mergeJson,
  proposalPath,
};
