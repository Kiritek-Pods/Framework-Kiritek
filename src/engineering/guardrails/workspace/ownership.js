"use strict";

/**
 * Ownership de paths → unidades (T05.1).
 *
 * Cada path cambiado obtiene cero, una o varias unidades dueñas por
 * `owns/excludes`, conservando la razón (glob que coincidió o que excluyó).
 * Un path sin dueño se clasifica como `shared` (sharedPaths o archivo raíz
 * del repo: lockfiles, tooling) o `unowned`; ninguno se descarta en silencio.
 */

const { assertRepoRelativePath } = require("../contracts/common.js");
const { firstMatch } = require("./glob.js");

const PATH_STATUS = Object.freeze({ OWNED: "owned", SHARED: "shared", UNOWNED: "unowned" });

function isRootLevel(p) {
  return !p.includes("/");
}

/**
 * @param {string} relPath
 * @param {{id, owns, excludes}[]} units
 * @param {string[]} sharedPaths
 */
function ownersOf(relPath, units, sharedPaths = []) {
  assertRepoRelativePath(relPath, "path");
  const owners = [];
  const excludedBy = [];
  for (const u of units) {
    const own = firstMatch(u.owns, relPath);
    if (!own) continue;
    const ex = firstMatch(u.excludes, relPath);
    if (ex) excludedBy.push({ unitId: u.id, reason: `excludes:${ex}` });
    else owners.push({ unitId: u.id, reason: `owns:${own}` });
  }
  const shared = firstMatch(sharedPaths, relPath);
  let status = PATH_STATUS.OWNED;
  let sharedReason = null;
  if (owners.length === 0) {
    if (shared) {
      status = PATH_STATUS.SHARED;
      sharedReason = `sharedPaths:${shared}`;
    } else if (isRootLevel(relPath)) {
      status = PATH_STATUS.SHARED;
      sharedReason = "root-level";
    } else {
      status = PATH_STATUS.UNOWNED;
    }
  } else if (shared) {
    sharedReason = `sharedPaths:${shared}`;
  }
  const out = { path: relPath, status, owners, excludedBy };
  if (sharedReason) out.sharedReason = sharedReason;
  return out;
}

module.exports = { PATH_STATUS, ownersOf };
