"use strict";

/**
 * Integridad del catálogo (R4, R22; design §17).
 *
 * Digest: SHA-256 del JSON canónico de
 *   { catalog: <catalog.json sin digest/signature>, files: { <ruta>: sha256 } }
 * donde `files` son todos los archivos del directorio de la versión excepto
 * `catalog.json` y el archivo de firma. Así el digest fija también los
 * schemas de parámetros y cualquier otro artefacto distribuido.
 *
 * Firma (opcional): `signature.signatureRef` apunta a un archivo con la firma
 * base64 sobre los bytes UTF-8 del digest. Se verifica contra claves de
 * confianza locales; nunca contra claves que trae el propio catálogo.
 */

const crypto = require("node:crypto");
const { hashJson, sha256Of } = require("../canonical.js");
const { raise } = require("../errors.js");

const CATALOG_FILE = "catalog.json";
const SIGNATURE_STATUS = Object.freeze({ VERIFIED: "verified", ABSENT: "absent", UNTRUSTED_KEY: "untrusted-key" });

function contentFiles(doc, fileMap) {
  const sigRef = doc && doc.signature ? doc.signature.signatureRef : null;
  const out = {};
  for (const rel of Object.keys(fileMap).sort()) {
    if (rel === CATALOG_FILE || rel === sigRef) continue;
    out[rel] = sha256Of(fileMap[rel]);
  }
  return out;
}

function computeCatalogDigest(doc, fileMap) {
  const { digest, signature, ...rest } = doc;
  return hashJson({ catalog: rest, files: contentFiles(doc, fileMap) });
}

function verifyCatalogDigest(doc, fileMap) {
  const actual = computeCatalogDigest(doc, fileMap);
  if (actual !== doc.digest) {
    raise("CATALOG_DIGEST_MISMATCH", `el digest del catálogo ${doc.version} no coincide con su contenido`, {
      pointer: "catalog.json#/digest",
      remediation: "Reinstale el catálogo desde una fuente verificada; no edite catálogos publicados.",
    });
  }
  return contentFiles(doc, fileMap);
}

/**
 * @param {object} doc
 * @param {Record<string, Buffer|string>} fileMap
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.trustedKeys] keyId → clave pública PEM.
 * @param {boolean} [opts.requireSignature]
 * @returns {"verified"|"absent"|"untrusted-key"}
 */
function verifyCatalogSignature(doc, fileMap, opts = {}) {
  const trustedKeys = opts.trustedKeys || {};
  if (!doc.signature) {
    if (opts.requireSignature) {
      raise("CATALOG_SIGNATURE_REQUIRED", `el catálogo ${doc.version} no está firmado y la política exige firma`, {
        remediation: "Use un catálogo firmado o desactive requireSignature de forma explícita.",
      });
    }
    return SIGNATURE_STATUS.ABSENT;
  }
  const { keyId, algorithm, signatureRef } = doc.signature;
  const pem = trustedKeys[keyId];
  if (!pem) {
    if (opts.requireSignature) {
      raise("CATALOG_SIGNATURE_UNTRUSTED", `clave de firma '${keyId}' no está en las claves de confianza`, {
        remediation: "Agregue la clave pública a la trust policy local tras verificarla fuera de banda.",
      });
    }
    return SIGNATURE_STATUS.UNTRUSTED_KEY;
  }
  const raw = fileMap[signatureRef];
  if (raw === undefined) raise("CATALOG_SIGNATURE_INVALID", `falta el archivo de firma ${signatureRef}`);
  let ok = false;
  try {
    const sig = Buffer.from(String(raw).trim(), "base64");
    const hashAlg = algorithm === "ed25519" ? null : "sha256";
    ok = crypto.verify(hashAlg, Buffer.from(doc.digest, "utf8"), crypto.createPublicKey(pem), sig);
  } catch (err) {
    ok = false;
  }
  if (!ok) raise("CATALOG_SIGNATURE_INVALID", `firma inválida para el catálogo ${doc.version}`);
  return SIGNATURE_STATUS.VERIFIED;
}

module.exports = {
  CATALOG_FILE,
  SIGNATURE_STATUS,
  contentFiles,
  computeCatalogDigest,
  verifyCatalogDigest,
  verifyCatalogSignature,
};
