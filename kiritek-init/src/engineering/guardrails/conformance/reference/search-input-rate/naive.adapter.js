"use strict";
// Implementación ingenua: busca en cada tecla, sin mínimo, sin cancelar, sin
// guarda de obsolescencia, sin dedupe y sin mostrar errores.
exports.createSearchUnderTest = ({ transport, onResults }) => ({
  type(q) {
    transport.search(q).then((r) => onResults(q, r), () => {});
  },
});
