"use strict";

/**
 * Generador del plan del provider AWS CodeCommit ENDURECIDO (tarea 40).
 *
 * Extiende el generador mínimo de la tarea 38. Un plan de CodeCommit es un
 * ARTEFACTO DESCRITO (dry-run): enumera la infraestructura que un operador
 * aplicaría para endurecer el repositorio en AWS —IAM de mínimo privilegio
 * para operaciones sobre la rama default/destructivas, approval rule templates
 * con revisores mínimos y separación de funciones, un pipeline CodeBuild/
 * CodePipeline con gates core y aprobación manual antes de producción, y
 * alertas SNS/EventBridge sin secretos— junto con los permisos que harían
 * falta, PERO nunca muta estado cloud ni abre red por su cuenta. Cualquier
 * aplicación requiere confirmación humana EXPLÍCITA fuera de este plan
 * (contrato base, 16.1/40.6/22.6/G.9).
 *
 * Invariantes que este módulo garantiza por diseño:
 *  - Aislamiento de packs (16.8/17.1): NO importa a github ni al instalador del
 *    core. Un pack no instala al otro ni al core.
 *  - Cero red por defecto (16.1/40.6): la observación remota se delega a un
 *    transporte INYECTABLE. Sin transporte, `generate` no abre red: el estado
 *    honesto es `unknown` (hay credencial, pero no se observó) o
 *    `not-configured` (no hay credencial). Nunca `observed` sin observación.
 *  - No aplicar cloud (40.6): el plan no tiene ruta de apply; emite COMANDOS
 *    descriptivos (aws cli / plantilla IaC) que el operador correría tras una
 *    confirmación humana explícita, nunca ejecutados por el pack.
 *  - IAM mínimo privilegio (16.2/27.4): las acciones se acotan a la rama default
 *    y operaciones destructivas, por rol y por entorno; se incluyen separación
 *    de funciones y prevención de autoaprobación donde AWS lo permite.
 *  - Determinismo (22.6): mismo input → mismo partial (byte-idéntico). El reloj
 *    y el id los añade el contrato base; este módulo no usa `Date`/`random`.
 *  - Redacción (26.9): las credenciales se leen SÓLO del entorno y jamás se
 *    imprimen; sólo se reporta su PRESENCIA. Preferencia por roles/credenciales
 *    temporales; detección de claves obsoletas redactada (40.4).
 *  - Nunca reemplaza los controles locales (40.5): IAM sobre la rama default NO
 *    impide que un secreto llegue a una feature branch; los escaneos local,
 *    pre-push y CI siguen siendo obligatorios.
 */

const base = require("./base.js");

const PROVIDER = "aws-codecommit";

/** Rama default por defecto cuando la config no la fija explícitamente. */
const DEFAULT_BRANCH_FALLBACK = "main";

/** Revisores mínimos por defecto en la approval rule template (16.4/40.2). */
const DEFAULT_MIN_REVIEWERS = 2;

/** Entorno por defecto cuando la config no fija uno. */
const DEFAULT_ENVIRONMENT = "prod";

/**
 * LIMITACIÓN honesta que se REPITE en el plan y en las plantillas/docs (40.5,
 * requisito 16.3/27.4/G.10): IAM sobre la rama default NO impide que un secreto
 * llegue a una feature branch. Mantener local/pre-push/CI.
 */
const DEFAULT_BRANCH_LIMITATION =
  "LIMITACIÓN: el control IAM/approval sobre la rama default NO impide que un " +
  "secreto llegue a una feature branch. Protege la rama default, no las ramas " +
  "de feature. Los escaneos local, pre-push y CI siguen siendo obligatorios.";

/**
 * Operaciones CodeCommit DESTRUCTIVAS o sobre la rama default que el IAM de
 * mínimo privilegio debe acotar por condición (nunca `Resource: *`). Describe
 * el alcance; la plantilla IAM concreta las condiciones por rama/entorno.
 */
const DESTRUCTIVE_ACTIONS = Object.freeze([
  "codecommit:GitPush",
  "codecommit:DeleteBranch",
  "codecommit:PutFile",
  "codecommit:MergeBranchesByFastForward",
  "codecommit:MergePullRequestByFastForward",
  "codecommit:UpdateDefaultBranch",
]);

/**
 * ¿Hay credenciales AWS PRESENTES en el entorno? Sólo se reporta PRESENCIA; el
 * valor jamás se lee para imprimirlo. Se prefieren roles/credenciales
 * temporales (40.4), por eso también cuenta el token de sesión / web identity.
 */
function hasCredential(env = {}) {
  const nonEmpty = (k) => typeof env[k] === "string" && env[k].trim() !== "";
  return (
    (nonEmpty("AWS_ACCESS_KEY_ID") && nonEmpty("AWS_SECRET_ACCESS_KEY")) ||
    nonEmpty("AWS_PROFILE") ||
    nonEmpty("AWS_WEB_IDENTITY_TOKEN_FILE") ||
    nonEmpty("AWS_SESSION_TOKEN")
  );
}

/**
 * ¿Se usan credenciales TEMPORALES/por rol (preferidas, 40.4)? Un rol asumido
 * expone `AWS_SESSION_TOKEN` o un web-identity token; una clave de larga
 * duración expone sólo `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Reporta
 * sólo la MODALIDAD, nunca el valor.
 */
function usesTemporaryCredential(env = {}) {
  const nonEmpty = (k) => typeof env[k] === "string" && env[k].trim() !== "";
  return nonEmpty("AWS_SESSION_TOKEN") || nonEmpty("AWS_WEB_IDENTITY_TOKEN_FILE");
}

/**
 * Detecta una clave de ACCESO de larga duración (potencialmente obsoleta/estática)
 * presente en el entorno. Devuelve sólo señal booleana REDACTADA (40.4): nunca
 * el valor de la clave. La "obsolescencia" real (antigüedad/rotación) sólo puede
 * confirmarse observando IAM remotamente; sin observación, se reporta la señal
 * estática de que hay una clave de larga duración que debería rotarse/revocarse.
 */
function hasStaticAccessKey(env = {}) {
  const nonEmpty = (k) => typeof env[k] === "string" && env[k].trim() !== "";
  return (
    nonEmpty("AWS_ACCESS_KEY_ID") &&
    nonEmpty("AWS_SECRET_ACCESS_KEY") &&
    !nonEmpty("AWS_SESSION_TOKEN")
  );
}

/** Resuelve la rama default desde la config (explícita) o el fallback seguro. */
function resolveDefaultBranch(config = {}) {
  const db = config && config.defaultBranch;
  if (db && typeof db.explicit === "string" && db.explicit.trim() !== "") {
    return db.explicit.trim();
  }
  return DEFAULT_BRANCH_FALLBACK;
}

/** Resuelve el nombre del entorno (parámetro por entorno, 40.1). */
function resolveEnvironment(config = {}) {
  const cc = config && config.codecommit;
  if (cc && typeof cc.environment === "string" && cc.environment.trim() !== "") {
    return cc.environment.trim();
  }
  return DEFAULT_ENVIRONMENT;
}

/** Resuelve el número mínimo de revisores de la approval rule (40.2). */
function resolveMinReviewers(config = {}) {
  const cc = config && config.codecommit;
  if (cc && Number.isInteger(cc.minReviewers) && cc.minReviewers >= 1) {
    return cc.minReviewers;
  }
  return DEFAULT_MIN_REVIEWERS;
}

/** Resuelve el nombre del repositorio CodeCommit (parámetro, placeholder). */
function resolveRepository(config = {}) {
  const cc = config && config.codecommit;
  if (cc && typeof cc.repository === "string" && cc.repository.trim() !== "") {
    return cc.repository.trim();
  }
  return "{repository}";
}

/**
 * Normaliza el resultado de una observación remota a un estado del contrato
 * base. Diferencia explícitamente (mismo criterio que github.js):
 *   - 401/403 → unauthorized (credencial presente pero acceso denegado)
 *   - 404     → not-configured (el recurso no existe / no está configurado)
 *   - 200     → observed
 *   - resto   → unknown
 */
function classifyObservation(result, credentialPresent) {
  if (!result || typeof result !== "object") {
    return { status: credentialPresent ? base.OBSERVATION.UNKNOWN : base.OBSERVATION.NOT_CONFIGURED };
  }
  const enabled = typeof result.enabled === "boolean" ? result.enabled : undefined;
  if (result.status && base.OBSERVATIONS.includes(result.status)) {
    return { status: result.status, httpStatus: result.httpStatus, reason: result.reason, enabled };
  }
  const http = result.httpStatus;
  if (http === 401 || http === 403) {
    return { status: base.OBSERVATION.UNAUTHORIZED, httpStatus: http, reason: result.reason, enabled };
  }
  if (http === 404) {
    return { status: base.OBSERVATION.NOT_CONFIGURED, httpStatus: http, reason: result.reason, enabled };
  }
  if (http === 200) {
    return { status: base.OBSERVATION.OBSERVED, httpStatus: http, reason: result.reason, enabled };
  }
  return { status: base.OBSERVATION.UNKNOWN, httpStatus: http, reason: result.reason, enabled };
}

/**
 * Transporte de observación por defecto: NO abre red. Devuelve un resultado
 * `unknown` honesto. Los tests inyectan un transporte sintético (mocks
 * 200/403/404) sin tocar la red real. Un transporte real (fuera de este plan)
 * recibiría `{ env, config, resource }` y devolvería `{ status, httpStatus?, reason? }`.
 */
function noNetworkTransport() {
  return { status: base.OBSERVATION.UNKNOWN, reason: "sin transporte de observación: no se abre red" };
}

/**
 * Comandos que el OPERADOR correría para aplicar/observar (nunca los ejecuta el
 * pack). Se incrustan en la descripción de los cambios (40.6: ofrecer
 * comandos/diff/plantilla sin afirmar éxito). Usan placeholders.
 */
function applyCommands({ repository, defaultBranch, environment }) {
  const stack = `kiritek-codecommit-${environment}`;
  return {
    iam:
      `aws cloudformation deploy --stack-name ${stack}-iam ` +
      "--template-file .kiritek/providers/aws-codecommit/iam-least-privilege.yaml " +
      `--parameter-overrides RepositoryName=${repository} DefaultBranch=${defaultBranch} Environment=${environment} ` +
      "--capabilities CAPABILITY_NAMED_IAM",
    approvalRule:
      `aws codecommit create-approval-rule-template ` +
      "--approval-rule-template-name kiritek-default-branch " +
      "--approval-rule-template-content file://.kiritek/providers/aws-codecommit/approval-rule-template.json",
    associateApprovalRule:
      `aws codecommit associate-approval-rule-template-with-repository ` +
      `--approval-rule-template-name kiritek-default-branch --repository-name ${repository}`,
    pipeline:
      `aws cloudformation deploy --stack-name ${stack}-pipeline ` +
      "--template-file .kiritek/providers/aws-codecommit/codepipeline.yaml " +
      `--parameter-overrides RepositoryName=${repository} DefaultBranch=${defaultBranch} Environment=${environment} ` +
      "--capabilities CAPABILITY_NAMED_IAM",
    notifications:
      `aws cloudformation deploy --stack-name ${stack}-alerts ` +
      "--template-file .kiritek/providers/aws-codecommit/sns-eventbridge.yaml " +
      `--parameter-overrides RepositoryName=${repository} Environment=${environment}`,
  };
}

/**
 * Genera la salida parcial para `buildPlan`. Determinista. No abre red salvo que
 * se inyecte un transporte de observación que lo haga (por defecto, no).
 *
 * @param {object} input  { env, config, observe? }
 *   - observe({ resource, env, config }) → { status?|httpStatus?, reason?,
 *     enabled? } : transporte de observación opcional. Por defecto sin red.
 * @returns {object} parcial de plan para base.buildPlan
 */
function generate(input = {}) {
  const env = input.env || {};
  const config = input.config || {};
  const credentialPresent = hasCredential(env);
  const temporaryCredential = usesTemporaryCredential(env);
  const staticKey = hasStaticAccessKey(env);
  const observe = typeof input.observe === "function" ? input.observe : null;

  const defaultBranch = resolveDefaultBranch(config);
  const environment = resolveEnvironment(config);
  const minReviewers = resolveMinReviewers(config);
  const repository = resolveRepository(config);
  const cmds = applyCommands({ repository, defaultBranch, environment });

  // ── Observación remota (dry-run). Sin transporte inyectado NO se abre red. ──
  function observeResource(resource) {
    if (!observe) {
      return classifyObservation(
        credentialPresent
          ? { status: base.OBSERVATION.UNKNOWN, reason: "credencial AWS presente; sin transporte de observación (no se abre red)" }
          : { status: base.OBSERVATION.NOT_CONFIGURED, reason: "sin credencial AWS en el entorno; nada que observar" },
        credentialPresent
      );
    }
    let raw;
    try {
      raw = observe({ resource, env, config });
    } catch (err) {
      return { status: base.OBSERVATION.UNKNOWN, reason: `observación falló: ${err.code || "error"}` };
    }
    return classifyObservation(raw, credentialPresent);
  }

  const iamObs = observeResource("iam-policies");
  const approvalObs = observeResource("approval-rule-template");
  const pipelineObs = observeResource("codepipeline");
  const notificationsObs = observeResource("notifications");

  // El estado global del plan refleja la observación del IAM, control principal.
  const observation = iamObs.status;
  const observationReason = buildObservationReason(observation, iamObs, credentialPresent);

  const permStatus = (obs) => obs.status;
  const requiredPermissions = [
    {
      id: "iam-manage-least-privilege",
      scope: "iam:CreatePolicy,iam:PutRolePolicy,iam:GetRole (acotado por path/condición)",
      status: permStatus(iamObs),
      reason:
        iamObs.httpStatus
          ? `observación de IAM devolvió HTTP ${iamObs.httpStatus}`
          : "necesario para desplegar IAM de mínimo privilegio sobre la rama default/destructivos; " +
            (credentialPresent ? "no observado (sin transporte)" : "sin credencial para observar"),
    },
    {
      id: "codecommit-approval-rules",
      scope: "codecommit:CreateApprovalRuleTemplate,AssociateApprovalRuleTemplateWithRepository",
      status: permStatus(approvalObs),
      reason: "necesario para planificar approval rule templates (revisores mínimos / separación de funciones)",
    },
    {
      id: "pipeline-manage",
      scope: "codepipeline:*,codebuild:* (acotado por recurso del stack)",
      status: permStatus(pipelineObs),
      reason: "necesario para planificar CodeBuild/CodePipeline con gates core y aprobación manual",
    },
    {
      id: "notifications-manage",
      scope: "sns:CreateTopic,events:PutRule (sin secretos; preferir roles)",
      status: permStatus(notificationsObs),
      reason: "necesario para planificar alertas SNS/EventBridge sin secretos",
    },
  ];

  const changes = buildChanges({
    defaultBranch,
    environment,
    minReviewers,
    repository,
    cmds,
    temporaryCredential,
    staticKey,
    pipelineObs,
    notificationsObs,
  });

  const parameters = [
    { name: "credentialPresent", resolved: credentialPresent, source: "env-presence" },
    { name: "temporaryCredential", resolved: temporaryCredential, source: "env-presence" },
    { name: "staticAccessKeyPresent", resolved: staticKey, source: "env-presence" },
    { name: "defaultBranch", resolved: defaultBranch, source: config.defaultBranch && config.defaultBranch.explicit ? "config" : "default" },
    { name: "environment", resolved: environment, source: config.codecommit && config.codecommit.environment ? "config" : "default" },
    { name: "minReviewers", resolved: minReviewers, source: config.codecommit && Number.isInteger(config.codecommit.minReviewers) ? "config" : "default" },
    { name: "repository", resolved: repository, source: config.codecommit && config.codecommit.repository ? "config" : "default" },
  ];

  const rollback = buildRollback({ environment, repository, defaultBranch });

  const reason = buildPlanReason({ observation, credentialPresent, defaultBranch, environment });

  return {
    provider: PROVIDER,
    observation,
    observationReason,
    changes,
    requiredPermissions,
    parameters,
    rollback,
    reason,
  };
}

/** Razón honesta del estado global de observación. */
function buildObservationReason(observation, iamObs, credentialPresent) {
  switch (observation) {
    case base.OBSERVATION.OBSERVED:
      return "configuración IAM observada remotamente (dry-run)";
    case base.OBSERVATION.UNAUTHORIZED:
      return (
        "acceso DENEGADO al observar IAM" +
        (iamObs.httpStatus ? ` (HTTP ${iamObs.httpStatus})` : "") +
        ": permiso insuficiente, no es que falte configuración"
      );
    case base.OBSERVATION.NOT_CONFIGURED:
      return credentialPresent
        ? "la política/rol IAM no existe/no está configurada en la cuenta (HTTP 404)"
        : "sin credencial AWS en el entorno (AWS_* / AWS_PROFILE); nada que observar";
    default:
      return credentialPresent
        ? "credencial AWS presente, pero no se observó remotamente (sin transporte; no se abre red)"
        : "sin credencial AWS en el entorno; nada que observar";
  }
}

/**
 * Construye los cambios DESCRITOS: IAM mínimo privilegio por rol/entorno +
 * approval rule template (revisores mínimos, separación de funciones,
 * prevención de autoaprobación) + CodeBuild/CodePipeline con gates core y
 * aprobación manual + alertas SNS/EventBridge sin secretos + la LIMITACIÓN
 * explícita (40.5). Cada descripción incluye el comando/plantilla que el
 * operador correría (40.6), nunca ejecutado por el pack.
 */
function buildChanges({
  defaultBranch,
  environment,
  minReviewers,
  repository,
  cmds,
  temporaryCredential,
  staticKey,
  pipelineObs,
  notificationsObs,
}) {
  const changes = [];

  // 40.1 — IAM de MÍNIMO PRIVILEGIO sobre la rama default / destructivos, por
  // rol y por entorno. Acota las acciones a la rama default por condición; nunca
  // `Resource: *` ni admin `*:*`.
  changes.push({
    id: "iam-least-privilege-default-branch",
    kind: "iam",
    target: `codecommit:${repository}:branch/${defaultBranch} (${environment})`,
    action: "create",
    description:
      `[MÍNIMO PRIVILEGIO] Política IAM por rol y entorno '${environment}' que DENIEGA las operaciones ` +
      `destructivas/sobre la rama default (${DESTRUCTIVE_ACTIONS.join(", ")}) salvo a los roles autorizados, ` +
      "acotando el Resource al ARN del repositorio y la rama por condición (nunca Resource:* ni admin *:*). " +
      `Plantilla IaC: .kiritek/providers/aws-codecommit/iam-least-privilege.yaml. ${DEFAULT_BRANCH_LIMITATION} ` +
      `Aplicar (requiere confirmación): ${cmds.iam}`,
  });

  // 40.2 — Approval rule template: revisores mínimos, separación de funciones y
  // prevención de autoaprobación donde AWS lo permite.
  changes.push({
    id: "approval-rule-default-branch",
    kind: "approval-rule",
    target: `codecommit:${repository}:approval-rule-template`,
    action: "create",
    description:
      `Approval rule template sobre la rama default '${defaultBranch}': exige ${minReviewers} revisor(es) mínimos, ` +
      "SEPARACIÓN DE FUNCIONES (el autor del PR no puede ser su único aprobador) y PREVENCIÓN DE AUTOAPROBACIÓN " +
      "mediante un pool de aprobadores por rol IAM distinto del autor. " +
      "Nota: CodeCommit no excluye nativamente al autor del conteo; la separación se refuerza con un pool de " +
      "aprobadores por rol IAM y la política IAM del cambio anterior. " +
      `Plantilla: .kiritek/providers/aws-codecommit/approval-rule-template.json. ${DEFAULT_BRANCH_LIMITATION} ` +
      `Aplicar (requiere confirmación): ${cmds.approvalRule} && ${cmds.associateApprovalRule}`,
  });

  // 40.3 — CodeBuild/CodePipeline con gates core, artefactos redactados y
  // aprobación MANUAL antes de producción.
  changes.push({
    id: "pipeline-core-gates",
    kind: "pipeline",
    target: `codepipeline:kiritek-${environment}`,
    action: pipelineObs.status === base.OBSERVATION.OBSERVED && pipelineObs.enabled === true ? "noop" : "create",
    description:
      "CodePipeline + CodeBuild que INVOCA los comandos core portables ('npx kiritek-init scan'); NO reimplementa " +
      "la detección. Artefactos REDACTADOS (sin secretos ni líneas fuente), permisos mínimos del rol de build, y una " +
      "etapa de APROBACIÓN MANUAL obligatoria antes de desplegar a producción. " +
      `Plantilla IaC: .kiritek/providers/aws-codecommit/codepipeline.yaml. ${DEFAULT_BRANCH_LIMITATION} ` +
      `Aplicar (requiere confirmación): ${cmds.pipeline}`,
  });

  // 40.4 — Alertas SNS/EventBridge SIN secretos; preferencia por roles/
  // credenciales temporales; rotación/revocación; detección de claves obsoletas
  // REDACTADA.
  const credNote = temporaryCredential
    ? "Credenciales temporales/por rol detectadas (preferido)."
    : "No se detectaron credenciales temporales; PREFERIR roles/credenciales temporales (STS) sobre claves de larga duración.";
  const staleNote = staticKey
    ? "DETECCIÓN REDACTADA: hay una clave de acceso de LARGA DURACIÓN en el entorno; planificar su ROTACIÓN/REVOCACIÓN (el valor nunca se imprime)."
    : "No se detectó una clave de acceso de larga duración en el entorno.";
  changes.push({
    id: "notifications-sns-eventbridge",
    kind: "notification",
    target: `sns+eventbridge:kiritek-${environment}`,
    action: notificationsObs.status === base.OBSERVATION.OBSERVED && notificationsObs.enabled === true ? "noop" : "create",
    description:
      "Reglas EventBridge sobre eventos de CodeCommit (push a rama default, borrado de rama, actualización de PR) " +
      "que publican en un topic SNS. SIN secretos en las plantillas ni en los mensajes (sólo metadata redactada). " +
      `${credNote} ${staleNote} Rotación/revocación de credenciales como procedimiento documentado. ` +
      `Plantilla IaC: .kiritek/providers/aws-codecommit/sns-eventbridge.yaml. ` +
      `Aplicar (requiere confirmación): ${cmds.notifications}`,
  });

  // 40.5 — REPETIR explícitamente la limitación como un cambio DESCRITO propio
  // (además de incrustarla en cada cambio y en las docs/plantillas).
  changes.push({
    id: "limitation-default-branch-vs-feature",
    kind: "other",
    target: "docs:.kiritek/providers/aws-codecommit/LIMITATIONS.md",
    action: "create",
    description:
      DEFAULT_BRANCH_LIMITATION +
      " Mantener los controles del core (hooks local y pre-push, y el gate de CI con Gitleaks) activos: " +
      "este pack los COMPLEMENTA, nunca los reemplaza. " +
      "Documento: .kiritek/providers/aws-codecommit/LIMITATIONS.md.",
  });

  return changes;
}

/** Pasos de rollback DESCRITOS (texto; nunca ejecutados). */
function buildRollback({ environment, repository, defaultBranch }) {
  const stack = `kiritek-codecommit-${environment}`;
  return [
    {
      id: "rollback-iam",
      description:
        `Si se desplegó el stack IAM: borrarlo con 'aws cloudformation delete-stack --stack-name ${stack}-iam' ` +
        "(requiere confirmación humana; el plan no aplica ni revierte). " +
        `Restaura el acceso previo a la rama '${defaultBranch}' según la política anterior.`,
    },
    {
      id: "rollback-approval-rule",
      description:
        "Si se asoció la approval rule template: desasociar con 'aws codecommit " +
        `disassociate-approval-rule-template-from-repository --approval-rule-template-name kiritek-default-branch ` +
        `--repository-name ${repository}' y luego 'delete-approval-rule-template' si ya no se usa.`,
    },
    {
      id: "rollback-pipeline",
      description:
        `Si se desplegó el pipeline: 'aws cloudformation delete-stack --stack-name ${stack}-pipeline'.`,
    },
    {
      id: "rollback-notifications",
      description:
        `Si se desplegaron las alertas: 'aws cloudformation delete-stack --stack-name ${stack}-alerts'.`,
    },
  ];
}

/** Razón del plan global. */
function buildPlanReason({ observation, credentialPresent, defaultBranch, environment }) {
  return (
    `Plan del pack AWS CodeCommit endurecido para la rama default '${defaultBranch}' (entorno '${environment}'): ` +
    "IAM de mínimo privilegio por rol/entorno sobre operaciones destructivas/rama default, approval rule template " +
    "con revisores mínimos y separación de funciones, CodeBuild/CodePipeline con gates core y aprobación manual " +
    "antes de producción, y alertas SNS/EventBridge sin secretos. Es un plan dry-run: no muta estado cloud ni abre " +
    "red; cualquier aplicación requiere confirmación humana explícita fuera del plan. " +
    DEFAULT_BRANCH_LIMITATION +
    " estado de observación=" + observation +
    (credentialPresent ? " (credencial presente)" : " (sin credencial)") + "."
  );
}

module.exports = {
  PROVIDER,
  DEFAULT_BRANCH_FALLBACK,
  DEFAULT_MIN_REVIEWERS,
  DEFAULT_ENVIRONMENT,
  DEFAULT_BRANCH_LIMITATION,
  DESTRUCTIVE_ACTIONS,
  generate,
  hasCredential,
  usesTemporaryCredential,
  hasStaticAccessKey,
  resolveDefaultBranch,
  resolveEnvironment,
  resolveMinReviewers,
  resolveRepository,
  classifyObservation,
  noNetworkTransport,
  applyCommands,
};
