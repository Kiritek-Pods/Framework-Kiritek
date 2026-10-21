"use strict";

/**
 * Grafo de impacto entre unidades (T05.2).
 *
 * Aristas `dependsOn`: A → B significa "A depende de B"; un cambio en B
 * impacta a A (dependiente). Los ciclos son válidos y se tratan como
 * componentes fuertemente conectados (Tarjan): un cambio en cualquier
 * miembro impacta a todo el componente.
 */

const { raise } = require("../errors.js");
const { compareIds } = require("./identity.js");

function buildImpactGraph(units) {
  const ids = new Set(units.map((u) => u.id));
  const deps = new Map();
  const dependents = new Map();
  for (const u of units) {
    deps.set(u.id, []);
    dependents.set(u.id, []);
  }
  for (const u of units) {
    for (const d of u.dependsOn || []) {
      if (!ids.has(d)) raise("SCOPE_UNKNOWN_DEPENDENCY", `${u.id} depende de unidad no declarada ${d}`);
      deps.get(u.id).push(d);
      dependents.get(d).push(u.id);
    }
  }

  // Tarjan iterativo-recursivo (tamaños de monorepo típicos).
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  const componentOf = new Map();
  const strong = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v)) {
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      comp.sort(compareIds);
      components.push(comp);
      for (const m of comp) componentOf.set(m, comp);
    }
  };
  for (const id of [...ids].sort(compareIds)) if (!index.has(id)) strong(id);

  const closure = (start, edges) => {
    const seen = new Set();
    const queue = [...start];
    while (queue.length) {
      const v = queue.shift();
      for (const m of componentOf.get(v)) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
      for (const w of edges.get(v)) {
        if (!seen.has(w)) {
          seen.add(w);
          queue.push(w);
        }
      }
    }
    return seen;
  };

  return {
    components: components.sort((a, b) => compareIds(a[0], b[0])),
    componentOf: (id) => componentOf.get(id) || null,
    cycles: () => components.filter((c) => c.length > 1),
    /** Unidades que dependen (transitivamente) de las dadas, sin incluirlas. */
    transitiveDependents(start) {
      const s = new Set(start);
      return [...closure(start, dependents)].filter((x) => !s.has(x)).sort(compareIds);
    },
    /** Dependencias (transitivas) de las dadas, sin incluirlas. */
    transitiveDependencies(start) {
      const s = new Set(start);
      return [...closure(start, deps)].filter((x) => !s.has(x)).sort(compareIds);
    },
  };
}

module.exports = { buildImpactGraph };
