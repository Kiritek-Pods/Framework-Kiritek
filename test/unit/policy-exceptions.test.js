"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const exceptions = require("../../src/policy/exceptions.js");
const securityCli = require("../../src/security-cli.js");
const { validateAgainst, loadSchema } = require("../../src/domain/schema-validator.js");
const { safeSerialize, findCanaries } = require("../../src/scanners/redactor.js");

const FIXED_CLOCK = "2026-10-01T12:00:00.000Z";
const fixedClock = () => FIXED_CLOCK;
const fixedNowMs = () => Date.parse(FIXED_CLOCK);

/** Excepción estándar mínima válida (no sensible: controlId genérico). */
function baseException(overrides = {}) {
  return {
    controlId: "custom.generic",
    scopeFingerprint: "test/fixtures/sample.txt:generic:3",
    reason: "Razón de prueba no funcional.",
    owner: "equipo-x",
    ticket: "SEC-100",
    expiresAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

// --- 31.1 campos mínimos + aprobador distinto cuando aplique ---

test("validateException: estándar no sensible con alcance mínimo es válida", () => {
  const r = exceptions.validateException(baseException(), { clock: fixedClock });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.type, "standard");
});

test("validateException: control sensible exige aprobador distinto del autor (28.2)", () => {
  // Sin approver → rechazo.
  const noApprover = exceptions.validateException(
    baseException({ controlId: "policy.files" }),
    { clock: fixedClock }
  );
  assert.equal(noApprover.valid, false);
  assert.ok(noApprover.errors.some((e) => /aprobador/.test(e)));

  // approver == owner → rechazo.
  const sameApprover = exceptions.validateException(
    baseException({ controlId: "secrets.gitleaks", owner: "ana", approver: "ana" }),
    { clock: fixedClock }
  );
  assert.equal(sameApprover.valid, false);
  assert.ok(sameApprover.errors.some((e) => /DISTINTO/.test(e)));

  // approver != owner → válida.
  const distinct = exceptions.validateException(
    baseException({ controlId: "secrets.gitleaks", owner: "ana", approver: "beto" }),
    { clock: fixedClock }
  );
  assert.equal(distinct.valid, true, JSON.stringify(distinct.errors));
});

test("validateException: faltan campos mínimos → inválida (vía contrato base, 28.1)", () => {
  const noTicket = exceptions.validateException(
    baseException({ ticket: undefined }),
    { clock: fixedClock }
  );
  assert.equal(noTicket.valid, false);
});

// --- 31.2 expiración / amplitud / reactivación / reporte ---

test("validateException: sin expiración o excesiva se rechaza (28.3)", () => {
  const noExpiry = exceptions.validateException(
    baseException({ expiresAt: undefined }),
    { clock: fixedClock }
  );
  assert.equal(noExpiry.valid, false);

  const tooLong = exceptions.validateException(
    baseException({ expiresAt: "2030-01-01T00:00:00.000Z" }),
    { clock: fixedClock }
  );
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.errors.some((e) => /exceder/.test(e)));
});

test("isScopeTooBroad: comodines amplios se rechazan, archivo concreto no (28.3)", () => {
  assert.equal(exceptions.isScopeTooBroad({ scopePath: "*" }), true);
  assert.equal(exceptions.isScopeTooBroad({ scopePath: "**" }), true);
  assert.equal(exceptions.isScopeTooBroad({ scopePath: "." }), true);
  assert.equal(exceptions.isScopeTooBroad({ scopePath: "src/**" }), true);
  assert.equal(exceptions.isScopeTooBroad({ scopePath: "src/*" }), true);
  assert.equal(exceptions.isScopeTooBroad({ scopePath: "src/a.js" }), false);
  // Un fingerprint exacto nunca es amplio.
  assert.equal(exceptions.isScopeTooBroad({ scopeFingerprint: "a.txt:r:1" }), false);
});

test("validateException: alcance amplio se rechaza en enforcement", () => {
  const broad = exceptions.validateException(
    { ...baseException({ scopeFingerprint: undefined, scopePath: "src/**" }) },
    { clock: fixedClock, mode: "enforce" }
  );
  assert.equal(broad.valid, false);
  assert.ok(broad.errors.some((e) => /amplio/.test(e)));
});

test("resolveState: reactiva al expirar o al cambiar fingerprint (28.4)", () => {
  const exc = {
    controlId: "custom.generic",
    scopeFingerprint: "a.txt:generic:1",
    owner: "o",
    ticket: "T-1",
    createdAt: FIXED_CLOCK,
    expiresAt: "2026-10-15T12:00:00.000Z",
  };
  // Vigente, mismo fingerprint → active.
  assert.equal(
    exceptions.resolveState(exc, { now: fixedNowMs, currentFingerprint: "a.txt:generic:1" }).state,
    "active"
  );
  // Fingerprint cambiado → reactivated (control vuelve a disparar).
  const changed = exceptions.resolveState(exc, { now: fixedNowMs, currentFingerprint: "a.txt:generic:999" });
  assert.equal(changed.state, "reactivated");
  assert.equal(changed.active, false);
  // Expirada → expired/reactivated.
  const future = () => Date.parse("2026-11-01T00:00:00.000Z");
  const expired = exceptions.resolveState(exc, { now: future });
  assert.equal(expired.state, "expired");
  assert.equal(expired.reactivated, true);
});

test("reportExceptions: reporta cantidad/edad/owner/estado SIN contenido sensible (28.5)", () => {
  const list = [
    {
      controlId: "custom.generic",
      scopeFingerprint: "a:r:1",
      owner: "ana",
      ticket: "SEC-1",
      reason: "razón privada que no debe aparecer textual en el conteo",
      createdAt: "2026-09-21T12:00:00.000Z",
      expiresAt: "2026-10-15T12:00:00.000Z",
    },
    {
      controlId: "custom.generic",
      scopePath: "b.txt",
      owner: "beto",
      ticket: "SEC-2",
      createdAt: "2026-09-01T12:00:00.000Z",
      expiresAt: "2026-09-15T12:00:00.000Z", // expirada respecto a FIXED_CLOCK
    },
  ];
  const rep = exceptions.reportExceptions(list, { now: fixedNowMs });
  assert.equal(rep.total, 2);
  assert.equal(rep.active, 1);
  assert.equal(rep.expired, 1);
  // Edad calculada (10 días la primera).
  assert.equal(rep.entries[0].ageDays, 10);
  assert.equal(rep.entries[0].owner, "ana");
  // El reporte no incluye la razón libre (sin contenido sensible).
  const json = JSON.stringify(rep);
  assert.equal(json.includes("razón privada"), false);
});

// --- 31.3 break-glass gobernado, nunca bypass ---

test("validateException: break-glass válido con todos los campos (7.5)", () => {
  const bg = exceptions.validateException(
    {
      type: "break-glass",
      controlId: "git.command-guard",
      scopePath: "src/release/hotfix.js",
      reason: "Hotfix de incidente.",
      motive: "Incidente P1 coordinado con guardia.",
      owner: "guardia",
      approver: "lead",
      ticket: "SEC-200",
      incident: "INC-1",
      postReview: true,
      expiresAt: "2026-10-03T12:00:00.000Z",
    },
    { clock: fixedClock }
  );
  assert.equal(bg.valid, true, JSON.stringify(bg.errors));
  assert.equal(bg.type, "break-glass");
});

test("validateException: break-glass sin motivo/incidente/revisión → inválido", () => {
  const bg = exceptions.validateException(
    {
      type: "break-glass",
      controlId: "git.command-guard",
      scopePath: "src/x.js",
      reason: "x",
      owner: "guardia",
      approver: "lead",
      ticket: "SEC-200",
      expiresAt: "2026-10-03T12:00:00.000Z",
      // falta motive, falta postReview
    },
    { clock: fixedClock }
  );
  assert.equal(bg.valid, false);
  assert.ok(bg.errors.some((e) => /motivo/.test(e)));
  assert.ok(bg.errors.some((e) => /revisión posterior/.test(e)));
});

test("validateException: break-glass exige aprobador distinto del autor", () => {
  const bg = exceptions.validateException(
    {
      type: "break-glass",
      controlId: "git.command-guard",
      scopePath: "src/x.js",
      reason: "x",
      motive: "incidente",
      owner: "ana",
      approver: "ana",
      ticket: "SEC-200",
      incident: "INC-1",
      postReview: true,
      expiresAt: "2026-10-03T12:00:00.000Z",
    },
    { clock: fixedClock }
  );
  assert.equal(bg.valid, false);
  assert.ok(bg.errors.some((e) => /DISTINTO/.test(e)));
});

// --- 31.6/28.6 mecanismos prohibidos NUNCA son excepción ---

test("detectProhibitedMechanisms: --no-verify / disable-workflow / edit-report", () => {
  // "--no-verify" contiene también la subcadena "no-verify": ambos patrones
  // coinciden, lo que es correcto (fail-closed). Comprobamos inclusión.
  const noVerify = exceptions.detectProhibitedMechanisms({ mechanism: "--no-verify" });
  assert.ok(noVerify.includes("--no-verify"));
  assert.ok(exceptions.detectProhibitedMechanisms({ disableWorkflow: true }).includes("disable-workflow"));
  assert.ok(exceptions.detectProhibitedMechanisms({ noVerify: true }).includes("no-verify"));
  assert.ok(
    exceptions.detectProhibitedMechanisms({ reason: "vamos a editar el reporte: edit-report" }).length > 0
  );
  assert.deepEqual(exceptions.detectProhibitedMechanisms({ reason: "razón legítima" }), []);
});

test("validateException: una excepción que invoca un bypass se rechaza (28.6)", () => {
  const bypass = exceptions.validateException(
    baseException({ mechanism: "--no-verify" }),
    { clock: fixedClock }
  );
  assert.equal(bypass.valid, false);
  assert.ok(bypass.errors.some((e) => /mecanismo prohibido/.test(e)));

  const disable = exceptions.validateException(
    baseException({ disableWorkflow: true }),
    { clock: fixedClock }
  );
  assert.equal(disable.valid, false);
});

// --- 31.4 ownership remoto honesto ---

test("assessRemoteOwnership: sin CODEOWNERS declara la limitación con honestidad (7.4/17.7)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-own-"));
  try {
    const r = exceptions.assessRemoteOwnership({ repoRoot: dir });
    assert.equal(r.supported, false);
    assert.equal(r.protected, false);
    assert.ok(/no se encontró CODEOWNERS/.test(r.reason));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assessRemoteOwnership: CODEOWNERS que cubre superficies sensibles → protegido (17.6)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-own-"));
  try {
    fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".github", "CODEOWNERS"),
      "/.github/workflows/ @equipo-seguridad\n/.kiritek/ @equipo-seguridad\n"
    );
    const r = exceptions.assessRemoteOwnership({ repoRoot: dir });
    assert.equal(r.supported, true);
    assert.equal(r.protected, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assessRemoteOwnership: CODEOWNERS que NO cubre lo sensible → no protegido, honesto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-own-"));
  try {
    fs.writeFileSync(path.join(dir, "CODEOWNERS"), "/docs/ @docs-team\n");
    const r = exceptions.assessRemoteOwnership({ repoRoot: dir });
    assert.equal(r.supported, true);
    assert.equal(r.protected, false);
    assert.ok(/cobertura insuficiente/.test(r.reason));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- 31.5 schema + property tests + CLI redactado ---

test("schema break-glass: fixture válido pasa; estándar sin break-glass campos no", () => {
  const bg = loadSchema("break-glass");
  assert.equal(bg.additionalProperties, false);
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "fixtures", "valid", "break-glass.json"), "utf8")
  );
  assert.equal(validateAgainst("break-glass", fixture).valid, true);
  // Falta motive → inválido por schema.
  const noMotive = { ...fixture };
  delete noMotive.motive;
  assert.equal(validateAgainst("break-glass", noMotive).valid, false);
});

test("property: expiración/amplitud/fingerprint y author==approver (generadores deterministas)", () => {
  // Generador determinista (sin red, sin fast-check): recorre el espacio
  // relevante de entradas y comprueba invariantes de gobernanza.
  // **Validates: Requirements 28.2, 28.3, 28.4**
  const owners = ["ana", "beto"];
  const approvers = ["ana", "beto", undefined];
  const scopes = [
    { scopeFingerprint: "a:r:1" }, // concreto
    { scopePath: "src/a.js" }, // concreto
    { scopePath: "src/**" }, // amplio
    { scopePath: "*" }, // amplio
  ];
  const expiries = [
    "2026-10-15T12:00:00.000Z", // ok
    "2030-01-01T00:00:00.000Z", // excesiva
    undefined, // ausente
  ];

  for (const controlId of ["custom.generic", "policy.files"]) {
    for (const owner of owners) {
      for (const approver of approvers) {
        for (const scope of scopes) {
          for (const expiresAt of expiries) {
            const input = {
              controlId,
              reason: "r",
              owner,
              ticket: "T-1",
              expiresAt,
              approver,
              ...scope,
            };
            const r = exceptions.validateException(input, { clock: fixedClock, mode: "enforce" });

            const sensitive = controlId === "policy.files";
            const broad = exceptions.isScopeTooBroad(scope);
            const expiryBad =
              expiresAt === undefined ||
              Date.parse(expiresAt) > Date.parse(FIXED_CLOCK) + 180 * 24 * 3600 * 1000;
            const approverBad = sensitive && (approver === undefined || approver === owner);

            const shouldBeInvalid = broad || expiryBad || approverBad;
            if (shouldBeInvalid) {
              assert.equal(
                r.valid,
                false,
                `esperaba inválida: ${JSON.stringify(input)} → ${JSON.stringify(r.errors)}`
              );
            } else {
              assert.equal(
                r.valid,
                true,
                `esperaba válida: ${JSON.stringify(input)} → ${JSON.stringify(r.errors)}`
              );
            }
          }
        }
      }
    }
  }
});

test("property: ningún mecanismo prohibido jamás produce una excepción válida (28.6)", () => {
  // **Validates: Requirements 28.6, 7.3**
  const prohibited = ["--no-verify", "disable-workflow", "skip ci", "edit-report"];
  for (const mech of prohibited) {
    const r = exceptions.validateException(
      {
        controlId: "custom.generic",
        scopeFingerprint: "a:r:1",
        reason: "r",
        owner: "o",
        ticket: "T-1",
        expiresAt: "2026-10-15T12:00:00.000Z",
        mechanism: mech,
      },
      { clock: fixedClock }
    );
    assert.equal(r.valid, false, `mecanismo ${mech} nunca debe ser válido`);
  }
  // La bandera booleana también.
  assert.equal(
    exceptions.validateException(
      {
        controlId: "custom.generic",
        scopeFingerprint: "a:r:1",
        reason: "r",
        owner: "o",
        ticket: "T-1",
        expiresAt: "2026-10-15T12:00:00.000Z",
        noVerify: true,
      },
      { clock: fixedClock }
    ).valid,
    false
  );
});

// --- CLI: security exception validate ---

function runCapture(argv, { cwd, env } = {}) {
  let out = "";
  let err = "";
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  const code = securityCli.run(argv, { cwd: cwd || process.cwd(), env: env || {}, stdout, stderr });
  let json = null;
  try {
    json = JSON.parse(out);
  } catch (_) {
    /* multi-línea */
  }
  return { code, out, err, json };
}

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-exc-cli-"));
}

test("CLI: security exception validate con archivo válido → exit 0 y resumen redactado", () => {
  const repo = tmpRepo();
  try {
    const file = path.join(repo, "exceptions.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          schemaVersion: 1,
          controlId: "custom.generic",
          scopeFingerprint: "a:r:1",
          reason: "r",
          owner: "ana",
          ticket: "SEC-1",
          createdAt: "2026-10-01T12:00:00.000Z",
          expiresAt: "2026-10-15T12:00:00.000Z",
        },
      ])
    );
    const r = runCapture(["security", "exception", "validate", `--file=${file}`], { cwd: repo });
    assert.equal(r.code, 0);
    assert.equal(r.json.target, "exception");
    assert.equal(r.json.valid, true);
    assert.equal(r.json.summary.total, 1);
    // Ownership honesto: sin CODEOWNERS en el repo temporal.
    assert.equal(r.json.remoteOwnership.supported, false);
    // Sin canarios en la salida.
    assert.equal(findCanaries(r.out).length, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI: security exception validate con entrada inválida → exit 1", () => {
  const repo = tmpRepo();
  try {
    const file = path.join(repo, "exceptions.json");
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          // control sensible sin approver → inválida bajo gobernanza
          controlId: "policy.files",
          scopePath: "src/a.js",
          reason: "r",
          owner: "ana",
          ticket: "SEC-1",
          createdAt: "2026-10-01T12:00:00.000Z",
          expiresAt: "2026-10-15T12:00:00.000Z",
        },
      ])
    );
    const r = runCapture(["security", "exception", "validate", `--file=${file}`], { cwd: repo });
    assert.equal(r.code, 1);
    assert.equal(r.json.valid, false);
    assert.ok(r.json.results.some((x) => !x.valid));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI: security exception validate con archivo ausente → exit 1 honesto", () => {
  const repo = tmpRepo();
  try {
    const r = runCapture(["security", "exception", "validate", "--file=/no/existe.json"], { cwd: repo });
    assert.equal(r.code, 1);
    assert.equal(r.json.error, "FILE_READ_ERROR");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("CLI: la salida de excepción con reason sensible cruza el redactor sin filtrar", () => {
  // El reporte no debe emitir el contenido crudo; verificamos que safeSerialize
  // no lanza y que no hay canarios (fail-closed).
  const rep = exceptions.reportExceptions([
    {
      controlId: "custom.generic",
      scopePath: "a.txt",
      owner: "ana",
      ticket: "SEC-1",
      createdAt: "2026-10-01T12:00:00.000Z",
      expiresAt: "2026-10-15T12:00:00.000Z",
    },
  ], { now: fixedNowMs });
  const s = safeSerialize(rep);
  assert.ok(s.json.length > 0);
  assert.equal(findCanaries(s.json).length, 0);
});
