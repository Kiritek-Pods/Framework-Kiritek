"use strict";

/**
 * Linter de MÍNIMO PRIVILEGIO para las políticas IAM / plantillas IaC EMITIDAS
 * por el pack AWS CodeCommit (tarea 40.7, requisito 16.2 / G.9–G.10). Es un
 * analizador estático (sin dependencias de parseo cloud): comprueba las
 * invariantes de seguridad que toda plantilla IAM del pack debe cumplir.
 *
 * Reglas:
 *  - admin-wildcard:   ninguna sentencia Allow usa `Action: "*"` ni `"*:*"`
 *                      (privilegio de administrador prohibido).
 *  - service-wildcard: ninguna sentencia Allow usa un comodín de servicio como
 *                      `codecommit:*` o `iam:*` (acción demasiado amplia).
 *  - destructive-resource-star: ninguna sentencia Allow sobre una acción
 *                      DESTRUCTIVA/sobre la rama default usa `Resource: "*"`
 *                      (el recurso debe acotarse al ARN del repo/rama).
 *  - deny-or-condition: las operaciones destructivas deben estar restringidas,
 *                      sea por una sentencia Deny explícita o por una condición
 *                      que acote el acceso (nunca un Allow abierto y sin
 *                      condición).
 *  - no-secrets:       la plantilla no incrusta credenciales/secretos (claves
 *                      AWS, tokens); sólo referencias a parámetros/roles.
 *
 * Entrada: un documento IAM (objeto JS o policy JSON embebido en una plantilla
 * CloudFormation/Terraform). `lintPolicyDocument` recibe el objeto de política;
 * `lintTemplateText` extrae y analiza todas las políticas de un texto de
 * plantilla.
 *
 * Devuelve { ok, violations:[{ code, message, statement? }] }.
 */

/** Acciones CodeCommit DESTRUCTIVAS / sobre la rama default (deben acotarse). */
const DESTRUCTIVE_ACTIONS = Object.freeze([
  "codecommit:GitPush",
  "codecommit:DeleteBranch",
  "codecommit:PutFile",
  "codecommit:MergeBranchesByFastForward",
  "codecommit:MergePullRequestByFastForward",
  "codecommit:UpdateDefaultBranch",
]);

/** Patrones de secreto que NUNCA deben aparecer embebidos en una plantilla. */
const SECRET_PATTERNS = Object.freeze([
  /AKIA[0-9A-Z]{16}/, // AWS access key id de larga duración
  /ASIA[0-9A-Z]{16}/, // AWS temporary access key id
  /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]);

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isAdminWildcard(action) {
  return action === "*" || action === "*:*";
}

function isServiceWildcard(action) {
  // p. ej. "codecommit:*", "iam:*" — comodín sobre todas las acciones del servicio.
  return typeof action === "string" && /^[a-z0-9-]+:\*$/i.test(action);
}

function isDestructive(action) {
  return DESTRUCTIVE_ACTIONS.includes(action);
}

function hasResourceStar(resource) {
  return toArray(resource).some((r) => r === "*");
}

function hasCondition(statement) {
  return (
    statement.Condition &&
    typeof statement.Condition === "object" &&
    Object.keys(statement.Condition).length > 0
  );
}

/**
 * Analiza un documento de política IAM (objeto). Devuelve violaciones de mínimo
 * privilegio. Sólo las sentencias con `Effect: "Allow"` abren acceso; una
 * sentencia `Deny` nunca viola el mínimo privilegio (restringe).
 */
function lintPolicyDocument(policy, opts = {}) {
  const violations = [];
  if (!policy || typeof policy !== "object") {
    violations.push({ code: "unparseable", message: "la política no es un objeto" });
    return { ok: false, violations };
  }
  const statements = toArray(policy.Statement);
  if (statements.length === 0) {
    violations.push({ code: "empty", message: "la política no tiene Statement" });
  }

  // ¿Existe alguna restricción (Deny o Allow condicionado) para destructivos?
  let destructiveRestricted = false;
  let destructiveSeen = false;

  for (const [i, stmt] of statements.entries()) {
    if (!stmt || typeof stmt !== "object") {
      violations.push({ code: "bad-statement", message: `Statement[${i}] inválido`, statement: i });
      continue;
    }
    const effect = stmt.Effect;
    const actions = toArray(stmt.Action);

    for (const action of actions) {
      if (isDestructive(action)) destructiveSeen = true;
      if (effect === "Deny" && isDestructive(action)) destructiveRestricted = true;
      if (effect === "Deny" && (isAdminWildcard(action) || isServiceWildcard(action))) {
        // Un Deny amplio es correcto (restringe); registra que se restringe.
        destructiveRestricted = true;
      }
      if (effect !== "Allow") continue;

      if (isAdminWildcard(action)) {
        violations.push({
          code: "admin-wildcard",
          message: `Statement[${i}] Allow usa Action admin "${action}" (prohibido)`,
          statement: i,
        });
      }
      if (isServiceWildcard(action)) {
        violations.push({
          code: "service-wildcard",
          message: `Statement[${i}] Allow usa comodín de servicio "${action}" (demasiado amplio)`,
          statement: i,
        });
      }
      if (isDestructive(action)) {
        if (hasResourceStar(stmt.Resource)) {
          violations.push({
            code: "destructive-resource-star",
            message: `Statement[${i}] Allow sobre acción destructiva "${action}" con Resource:* (debe acotarse al ARN)`,
            statement: i,
          });
        }
        // Un Allow destructivo CON condición acotada cuenta como restringido.
        if (hasCondition(stmt) && !hasResourceStar(stmt.Resource)) {
          destructiveRestricted = true;
        }
      }
    }
  }

  if (destructiveSeen && !destructiveRestricted) {
    violations.push({
      code: "deny-or-condition",
      message:
        "las operaciones destructivas/sobre la rama default deben restringirse por Deny explícito o condición acotada",
    });
  }

  if (opts.requireRestriction && !destructiveSeen) {
    violations.push({
      code: "no-destructive-rule",
      message: "la política no acota ninguna operación destructiva/sobre la rama default",
    });
  }

  return { ok: violations.length === 0, violations };
}

/** Extrae bloques JSON de política de un texto de plantilla (CFN/Terraform). */
function extractPolicyDocuments(text) {
  const docs = [];
  // Busca objetos JSON con un campo "Statement" (política IAM). Heurística de
  // balance de llaves a partir de cada aparición de "Statement".
  const re = /"Statement"\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Retrocede hasta la llave de apertura del objeto que contiene Statement.
    let start = text.lastIndexOf("{", m.index);
    while (start >= 0) {
      const slice = balancedObject(text, start);
      if (slice) {
        try {
          const parsed = JSON.parse(slice);
          if (parsed && parsed.Statement) {
            docs.push(parsed);
            break;
          }
        } catch (_) {
          /* intentar con una llave de apertura anterior */
        }
      }
      start = text.lastIndexOf("{", start - 1);
    }
  }
  return docs;
}

/** Devuelve el substring del objeto balanceado que empieza en `start` ('{'). */
function balancedObject(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Análisis estático de un texto de plantilla CloudFormation en YAML. Como el
 * extractor JSON no ve las políticas embebidas en YAML, aquí comprobamos las
 * invariantes clave por LÍNEA sobre el texto YAML:
 *  - admin/service wildcard en una acción,
 *  - uso de `Resource: "*"` cerca de una acción destructiva,
 *  - presencia de al menos una restricción (Deny o Condition) para destructivos.
 *
 * Devuelve un arreglo de violaciones (vacío si todo cumple).
 */
function lintYamlTemplate(text, opts = {}) {
  const violations = [];
  const lines = text.split("\n");

  // Ignora líneas de comentario YAML (`# ...`) para no analizar la explicación.
  const codeLines = lines.map((l) => (l.trimStart().startsWith("#") ? "" : l));

  let sawDestructiveAction = false;
  let sawDeny = false;
  let sawCondition = false;

  // Lista todas las acciones citadas como ítems de lista YAML (`- svc:Action`).
  const actionRe = /^\s*-\s*["']?((?:[a-z0-9-]+:[A-Za-z0-9*]+)|\*|\*:\*)["']?\s*$/;
  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i];
    if (/Effect:\s*Deny/.test(line)) sawDeny = true;
    if (/Condition:/.test(line)) sawCondition = true;

    const m = line.match(actionRe);
    if (!m) continue;
    const action = m[1];
    if (isAdminWildcard(action)) {
      violations.push({ code: "admin-wildcard", message: `Action admin "${action}" (prohibido)`, line: i + 1 });
    }
    if (isServiceWildcard(action)) {
      violations.push({ code: "service-wildcard", message: `comodín de servicio "${action}" (demasiado amplio)`, line: i + 1 });
    }
    if (isDestructive(action)) sawDestructiveAction = true;
  }

  // `Resource: "*"` / `Resource: *` en todo el documento (destructivos sin acotar).
  if (sawDestructiveAction && /Resource:\s*["']?\*["']?\s*$/m.test(codeLines.join("\n"))) {
    violations.push({
      code: "destructive-resource-star",
      message: "Resource:* junto a acciones destructivas (debe acotarse al ARN)",
    });
  }

  if (sawDestructiveAction && !(sawDeny || sawCondition)) {
    violations.push({
      code: "deny-or-condition",
      message: "las operaciones destructivas deben restringirse por Deny explícito o condición",
    });
  }
  if (opts.requireRestriction && !sawDestructiveAction) {
    violations.push({
      code: "no-destructive-rule",
      message: "la plantilla no acota ninguna operación destructiva/sobre la rama default",
    });
  }
  return violations;
}

/**
 * Analiza un TEXTO de plantilla IaC (CloudFormation JSON o YAML, o un policy
 * JSON embebido): extrae las políticas IAM que pueda parsear y, cuando no haya
 * JSON parseable (p. ej. YAML CFN), aplica el análisis estático por línea.
 * Además comprueba que el texto no incrusta secretos.
 */
function lintTemplateText(text, opts = {}) {
  const violations = [];
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, violations: [{ code: "empty-template", message: "plantilla vacía" }] };
  }

  for (const pat of SECRET_PATTERNS) {
    if (pat.test(text)) {
      violations.push({ code: "no-secrets", message: "la plantilla parece incrustar un secreto/credencial" });
      break;
    }
  }

  const docs = extractPolicyDocuments(text);
  if (docs.length > 0) {
    // Hay políticas JSON parseables: audítalas estructuralmente.
    for (const doc of docs) {
      const res = lintPolicyDocument(doc, opts);
      for (const v of res.violations) violations.push(v);
    }
  } else {
    // Sin JSON parseable: análisis estático por línea (YAML CFN).
    const yamlViolations = lintYamlTemplate(text, opts);
    if (yamlViolations.length === 0 && opts.requirePolicy && !/Statement/.test(text)) {
      violations.push({ code: "no-policy", message: "no se encontró ninguna política IAM en la plantilla" });
    }
    for (const v of yamlViolations) violations.push(v);
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
  DESTRUCTIVE_ACTIONS,
  SECRET_PATTERNS,
  lintPolicyDocument,
  lintTemplateText,
  lintYamlTemplate,
  extractPolicyDocuments,
};
