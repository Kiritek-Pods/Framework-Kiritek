"use strict";

/**
 * Identidad estable de unidades (R14; design §7).
 *
 * `unit.id` es la autoridad. Los aliases (`identityAliases`) son gobernados:
 * permiten resolver un id anterior tras un rename, pero un alias no puede
 * pertenecer a dos unidades ni coincidir con un id vigente. Mover el root
 * conserva la identidad si el id se mantiene; `rootHash` cambia y con él se
 * invalida la evidencia ligada al root anterior.
 */

const { hashJson } = require("../canonical.js");
const { raise } = require("../errors.js");

/** Hash del root de la unidad para el envelope (no expone la ruta). */
function unitRootHash(unit) {
  return hashJson({ id: unit.id, root: unit.root });
}

function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {{id: string, identityAliases?: string[]}[]} units
 */
function createIdentityIndex(units) {
  const byId = new Map();
  const byAlias = new Map();
  for (const u of units) {
    if (byId.has(u.id)) raise("IDENTITY_CONFLICT", `unidad duplicada "${u.id}"`);
    byId.set(u.id, u);
  }
  for (const u of units) {
    for (const alias of u.identityAliases || []) {
      if (byId.has(alias)) raise("IDENTITY_CONFLICT", `alias "${alias}" de ${u.id} coincide con una unidad vigente`);
      if (byAlias.has(alias) && byAlias.get(alias) !== u.id) {
        raise("IDENTITY_CONFLICT", `alias "${alias}" reclamado por ${byAlias.get(alias)} y ${u.id}`, {
          remediation: "Un alias sólo puede apuntar a una unidad; corrija la migración de identidad.",
        });
      }
      byAlias.set(alias, u.id);
    }
  }
  return {
    /** @returns {{id: string, via: "id"|"alias"} | null} */
    resolve(idOrAlias) {
      if (byId.has(idOrAlias)) return { id: idOrAlias, via: "id" };
      if (byAlias.has(idOrAlias)) return { id: byAlias.get(idOrAlias), via: "alias" };
      return null;
    },
    get(id) {
      return byId.get(id) || null;
    },
    ids() {
      return [...byId.keys()].sort(compareIds);
    },
  };
}

module.exports = { unitRootHash, createIdentityIndex, compareIds };
