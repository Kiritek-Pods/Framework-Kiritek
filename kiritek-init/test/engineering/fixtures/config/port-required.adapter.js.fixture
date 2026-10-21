"use strict";

// Adapter de referencia de svc.startup-config (port-required): exige una variable opcional
// Variables: DATABASE_URL (url), API_TOKEN (secreto), REGION (texto) obligatorias; PORT (int) y LOG_LEVEL (enum) opcionales.
const OPTS = {"portRequired":true};

const LEVELS = ["debug", "info", "warn", "error"];

function loadConfig(env) {
  const problems = [];
  const need = (name) => {
    if (env[name] === undefined || env[name] === "") problems.push(`${name} es obligatoria`);
    return env[name];
  };
  const databaseUrl = need("DATABASE_URL");
  const apiToken = need("API_TOKEN");
  const region = need("REGION");
  const port = env.PORT === undefined ? (OPTS.portRequired ? (problems.push("PORT es obligatoria"), undefined) : "8080") : env.PORT;
  const logLevel = env.LOG_LEVEL === undefined ? "info" : env.LOG_LEVEL;
  if (!OPTS.noValidation) {
    if (databaseUrl !== undefined && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(databaseUrl)) problems.push("DATABASE_URL no es una URL");
    if (port !== undefined && !/^\d+$/.test(port)) problems.push("PORT debe ser un número");
    if (!LEVELS.includes(logLevel)) problems.push(`LOG_LEVEL debe ser uno de ${LEVELS.join(", ")}`);
  }
  if (problems.length) {
    const msg = OPTS.vagueError ? "configuración inválida" : `configuración inválida: ${problems.join("; ")}`;
    throw new Error(OPTS.dumpEnv ? `${msg} (env: ${JSON.stringify(env)})` : msg);
  }
  return { databaseUrl, apiToken, region, port: Number(port), logLevel };
}

exports.startService = async ({ env, logger }) => {
  if (OPTS.lazy) {
    // Lee la configuración recién en la primera request: arranca siempre.
    return { handle: async () => ({ status: 200, body: loadConfig(env).region }) };
  }
  try {
    const config = loadConfig(env);
    return { config, handle: async () => ({ status: 200, body: { ok: true } }) };
  } catch (err) {
    logger.write(JSON.stringify({ level: "fatal", msg: err.message }));
    throw err;
  }
};
