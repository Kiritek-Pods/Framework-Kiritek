"use strict";

/**
 * Docs-lint (tarea 43.7): valida la documentación operativa de seguridad contra
 * la realidad del código y contra las prohibiciones del framework.
 *
 * Afirma que:
 *  - los flags documentados existen en cli-parser (`KNOWN_FLAGS`);
 *  - los comandos documentados existen en security-cli;
 *  - no hay recomendaciones de pins mutables (`@latest`, tags móviles) ni de
 *    instalar ejecutando un script remoto ("curl | sh");
 *  - no hay lenguaje de "gate por autoría IA" y SÍ está la prohibición explícita;
 *  - la limitación de feature branches está presente;
 *  - no hay secretos/canarios reales en los docs.
 *
 * El alcance son los documentos que esta tarea posee (los `docs/*.md` de
 * seguridad, los `LIMITATIONS.md` de los providers y la sección de seguridad del
 * README), no el README legacy completo.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const { KNOWN_FLAGS } = require("../../src/cli-parser.js");
const securityCliSource = fs.readFileSync(
  path.join(ROOT, "src", "security-cli.js"),
  "utf8"
);
const providersIndexSource = fs.readFileSync(
  path.join(ROOT, "src", "providers", "index.js"),
  "utf8"
);
// Nombres de provider soportados por el registro (fuente de verdad real).
const { SUPPORTED: SUPPORTED_PROVIDERS } = require("../../src/providers/index.js");

/**
 * Tokens que aparecen con sintaxis `--x` en los docs pero NO son flags del CLI
 * de Kiritek: flags de git que documentamos (p. ej. `--no-verify`, `--force`,
 * `--force-with-lease`) y marcadores genéricos de ejemplo (`--k`, `--no-<flag>`).
 */
const NON_CLI_FLAG_TOKENS = new Set([
  "verify", // de `--no-verify` (git), que denegamos
  "force", // de `--force`/`--force-with-lease` (git)
  "k", // de `--k=v` / `--k v` (ejemplo genérico de sintaxis)
  "flag", // de `--no-<flag>` (meta)
  "", // artefacto de `--<flag>` en texto meta
]);

const DOCS_DIR = path.join(ROOT, "templates", "core", "security", "docs");
const SECURITY_DOCS = [
  path.join(DOCS_DIR, "SECURITY.md"),
  path.join(DOCS_DIR, "PROVIDERS.md"),
  path.join(DOCS_DIR, "RELEASE.md"),
  path.join(DOCS_DIR, "CHANGELOG.md"),
  path.join(DOCS_DIR, "INCIDENT-RESPONSE.md"),
  path.join(DOCS_DIR, "MIGRATION.md"),
  path.join(DOCS_DIR, "COMPATIBILITY.md"),
  path.join(ROOT, "templates", "providers", "github", "LIMITATIONS.md"),
  path.join(ROOT, "templates", "providers", "aws-codecommit", "LIMITATIONS.md"),
];

function read(p) {
  return fs.readFileSync(p, "utf8");
}

/** Sección de seguridad del README (desde "## 6. Seguridad integral" hasta la próxima "## "). */
function readmeSecuritySection() {
  const readme = read(path.join(ROOT, "README.md"));
  const start = readme.indexOf("## 6. Seguridad integral");
  assert.notEqual(start, -1, "el README debe tener la sección de seguridad");
  const rest = readme.slice(start + 1);
  const next = rest.indexOf("\n## ");
  return next === -1 ? readme.slice(start) : readme.slice(start, start + 1 + next);
}

// --- 1. Links internos resuelven a archivos existentes ---

test("docs: los enlaces relativos a archivos existen", () => {
  const linkRe = /\]\((\.[^)]+\.md)\)/g;
  for (const doc of SECURITY_DOCS) {
    const content = read(doc);
    let m;
    while ((m = linkRe.exec(content)) !== null) {
      const target = m[1].split("#")[0];
      const resolved = path.resolve(path.dirname(doc), target);
      assert.ok(
        fs.existsSync(resolved),
        `${path.basename(doc)}: enlace roto a ${target}`
      );
    }
  }
});

// --- 2. Los flags documentados existen en cli-parser ---

test("docs: todo --flag documentado existe en KNOWN_FLAGS", () => {
  const known = new Set(Object.keys(KNOWN_FLAGS));
  // Valores de enum habituales que aparecen tras `=` y no son flags.
  const flagRe = /--([a-z][a-z0-9-]*)/g;
  const corpus = SECURITY_DOCS.map(read).join("\n") + "\n" + readmeSecuritySection();
  let m;
  const seen = new Set();
  while ((m = flagRe.exec(corpus)) !== null) {
    let name = m[1];
    if (name.startsWith("no-")) name = name.slice(3); // forma negada
    seen.add(name);
  }
  const unknown = [...seen].filter((f) => !known.has(f) && !NON_CLI_FLAG_TOKENS.has(f));
  assert.deepEqual(
    unknown,
    [],
    `flags documentados que no existen en KNOWN_FLAGS: ${unknown.join(", ")}`
  );
});

// --- 3. Los comandos documentados existen en security-cli ---

test("docs: los comandos de seguridad documentados existen en el CLI", () => {
  // Comandos/subcomandos que la doc promete y que el router debe reconocer.
  const commandTokens = [
    "scan",
    "validate",
    "commit",
    "push",
    "config",
    "claude-hook",
    "kiro-hook",
    "security",
    "audit",
    "doctor",
    "promote",
    "exception",
    "provider",
    "plan",
    "uninstall",
  ];
  for (const tok of commandTokens) {
    assert.ok(
      securityCliSource.includes(`"${tok}"`),
      `el CLI debe referenciar el comando/subcomando "${tok}"`
    );
  }
  // Los providers documentados deben existir en el registro real (SUPPORTED) y
  // ser claves en providers/index.js.
  for (const prov of ["github", "aws-codecommit"]) {
    assert.ok(
      SUPPORTED_PROVIDERS.includes(prov),
      `el provider "${prov}" debe estar soportado por el registro`
    );
    assert.ok(
      providersIndexSource.includes(prov),
      `providers/index.js debe referenciar el provider "${prov}"`
    );
  }
});

// --- 4. Sin pins mutables ni "curl | sh" ---

test("docs: sin @latest ni tags mutables recomendados", () => {
  for (const doc of SECURITY_DOCS) {
    const content = read(doc);
    assert.equal(/@latest\b/.test(content), false, `${path.basename(doc)} no debe recomendar @latest`);
    // Tag mutable típico en actions: @v1 / @main / @master.
    assert.equal(
      /uses:\s*[\w.\/-]+@(?:v?\d+(?:\.\d+)*|main|master|HEAD)\b/.test(content),
      false,
      `${path.basename(doc)} no debe fijar actions por tag mutable`
    );
  }
  const readmeSec = readmeSecuritySection();
  assert.equal(/@latest\b/.test(readmeSec), false, "la sección de seguridad del README no debe recomendar @latest");
});

test("docs: sin recomendaciones de 'curl | sh'", () => {
  const pipeToShell = /\bcurl\b[^\n|]*\|\s*(?:sh|bash|zsh)\b/i;
  for (const doc of SECURITY_DOCS) {
    const content = read(doc);
    assert.equal(pipeToShell.test(content), false, `${path.basename(doc)} no debe recomendar curl | sh`);
  }
  assert.equal(pipeToShell.test(readmeSecuritySection()), false, "la sección de seguridad del README no debe recomendar curl | sh");
});

// --- 5. Prohibición de gate por autoría IA ---

test("docs: declaran explícitamente que NO se bloquea por autoría IA", () => {
  const corpus = read(path.join(DOCS_DIR, "SECURITY.md"));
  assert.match(
    corpus,
    /no\s+(?:incluye|bloquea).*autor[ií]a\s+(?:de\s+)?IA|autor[ií]a\s+IA/i,
    "SECURITY.md debe prohibir explícitamente el gate por autoría IA"
  );
});

test("docs: no describen un detector de autoría IA COMO gate activo", () => {
  // Flaggear sólo AFIRMACIONES de bloqueo por autoría IA, no las prohibiciones.
  // Se analiza por oración: una oración que empareje "autoría" con un verbo de
  // bloqueo y NO esté negada ("no", "nunca", "jamás", "prohíbe") es sospechosa.
  const authorshipRe = /autor[ií]a\s+(?:de\s+)?IA|autor[ií]a\s+(?:humana|automática)|AI[- ]author/i;
  const blockVerbRe = /\b(?:bloquea|bloquear|gate|rechaza|deniega|impide el (?:commit|push|merge))\b/i;
  const negationRe = /\b(no|ni|ning[úu]n|nunca|jam[áa]s|proh[íi]be|proh[íi]bir|sin)\b/i;
  for (const doc of SECURITY_DOCS) {
    // Normalizar: quitar marcadores de blockquote y unir líneas envueltas
    // dentro de un mismo párrafo, para no partir una oración por el wrap.
    const normalized = read(doc)
      .replace(/^[ \t]*>[ \t]?/gm, "") // quita el prefijo de blockquote
      .replace(/([^\n])\n(?!\n)/g, "$1 "); // une líneas envueltas (no párrafos)
    const sentences = normalized.split(/(?<=[.;:])\s+|\n{2,}/);
    for (const s of sentences) {
      if (authorshipRe.test(s) && blockVerbRe.test(s) && !negationRe.test(s)) {
        assert.fail(`${path.basename(doc)}: posible gate por autoría IA en: "${s.trim()}"`);
      }
    }
  }
});

// --- 6. Limitación de feature branches presente ---

test("docs: la limitación de feature branches está presente", () => {
  const featureBranchRe = /feature\s*branch/i;
  const docsWithLimit = [
    path.join(DOCS_DIR, "SECURITY.md"),
    path.join(DOCS_DIR, "PROVIDERS.md"),
    path.join(DOCS_DIR, "INCIDENT-RESPONSE.md"),
    path.join(ROOT, "templates", "providers", "github", "LIMITATIONS.md"),
    path.join(ROOT, "templates", "providers", "aws-codecommit", "LIMITATIONS.md"),
  ];
  for (const doc of docsWithLimit) {
    const content = read(doc);
    assert.ok(featureBranchRe.test(content), `${path.basename(doc)} debe declarar la limitación de feature branches`);
    assert.match(
      content,
      /NO\s+protege.*feature\s*branch/i,
      `${path.basename(doc)} debe decir que la protección de la rama default NO protege feature branches`
    );
  }
});

// --- 7. Barrido anti-secreto/canario ---

test("docs: no contienen secretos ni canarios reales", () => {
  // Patrones de credencial real que nunca deben aparecer SIN ser placeholder.
  const corpus = SECURITY_DOCS.map(read).join("\n");
  // AWS access key real: AKIA + 16 alfanum mayúsculas. Permitimos placeholders
  // que incluyan "EXAMPLE".
  const akiaRe = /AKIA[0-9A-Z]{16}/g;
  let m;
  while ((m = akiaRe.exec(corpus)) !== null) {
    assert.match(m[0], /EXAMPLE/, `posible AWS key real en docs: ${m[0]}`);
  }
  // Claves privadas PEM embebidas.
  assert.equal(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(corpus), false, "no debe haber claves privadas PEM en docs");
  // Tokens típicos (GitHub ghp_, Slack xox...).
  assert.equal(/\bghp_[A-Za-z0-9]{36}\b/.test(corpus), false, "no debe haber tokens GitHub en docs");
  assert.equal(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/.test(corpus), false, "no debe haber tokens Slack en docs");
});

// --- 8. Checklist de docs 27.1–27.8 (presencia de secciones clave) ---

test("docs: el hub cubre arquitectura, matriz, defaults, flags, precedencia, exit codes y evidencia", () => {
  const hub = read(path.join(DOCS_DIR, "SECURITY.md"));
  for (const needle of [
    /Arquitectura/i,
    /Matriz de controles/i,
    /Defaults/i,
    /Flags del CLI/i,
    /Precedencia/i,
    /exit code/i,
    /Evidencia/i,
    /Ciclo de vida/i,
    /Runbooks/i,
  ]) {
    assert.match(hub, needle, `SECURITY.md debe cubrir ${needle}`);
  }
});
