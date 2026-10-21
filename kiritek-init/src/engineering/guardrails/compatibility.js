"use strict";

/**
 * Matriz de compatibilidad declarada del pack (T15C.3, R24.1–R24.3). Lo que
 * depende de plataforma se declara aquí y la auditoría lo reporta
 * `unavailable` donde no existe, en lugar de cumplimiento falso.
 */

const MATRIX = Object.freeze({
  node: { minimum: "18.0.0", plugins: "22.0.0", tested: ["18", "20", "22"] },
  os: {
    darwin: { support: "full" },
    linux: { support: "full" },
    win32: { support: "subset", note: "scan/audit/CI y adaptadores vía CLI; los shims de hooks Git/Kiro/Claude son POSIX sh y no se instalan" },
  },
  arch: ["x64", "arm64"],
  git: { minimum: "2.30.0", worktrees: true, shallow: "error operativo SCOPE_RANGE_INCOMPLETE (nunca deny)" },
  agents: { kiro: "hooks v1 PreToolUse (exit 0/2)", claude: "PreToolUse hookSpecificOutput.permissionDecision" },
  ci: { "github-actions": "plantilla incluida", other: "CLI provider-neutral (scan --format=json + anotaciones)" },
  network: { proxy: "HTTPS_PROXY/NO_PROXY se pasan sólo a collectors con permiso de red", ca: "NODE_EXTRA_CA_CERTS; la validación TLS nunca se desactiva", offline: "sólo catálogo, plugins y evidencia verificados localmente" },
  text: { lineEndings: "LF y CRLF en config/manifests/contratos", unicode: "rutas y contenido UTF-8", spaces: "rutas con espacios sin construir shell" },
});

/** Capacidades efectivas de esta plataforma. */
function platformCapabilities({ platform = process.platform, nodeVersion = process.versions.node } = {}) {
  const major = Number(String(nodeVersion).split(".")[0]);
  const posix = platform !== "win32";
  return {
    platform,
    support: (MATRIX.os[platform] || { support: "unsupported" }).support,
    gitHooks: posix,
    agentShims: posix,
    plugins: major >= 22,
  };
}

module.exports = { MATRIX, platformCapabilities };
