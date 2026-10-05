# Contratos de dominio — core de seguridad Kiritek

Estos módulos son los contratos compartidos del core de seguridad. No tienen
dependencias externas y validan sus propias invariantes, de modo que ningún
control, adaptador o reporte pueda construir un objeto inconsistente o que
transporte un valor sensible.

| Módulo | Responsabilidad |
| --- | --- |
| `result.js` | `PolicyResult` y `Finding`: decisión (`allow/warn/deny/error`), severidad, estado de herramienta y de hallazgo. Guardia de campos prohibidos. |
| `evidence.js` | `Evidence` y `supportsVerification`: respaldo reproducible de una afirmación `verified` (comando, versión, hash, alcance, exit code, timestamp). |
| `exception.js` | Excepciones gobernadas: alcance mínimo, propietario, ticket y expiración obligatoria y acotada. |
| `policy.js` | `PolicyInput`: evento normalizado que el motor de políticas evalúa. |
| `schema-validator.js` | Validador de un subconjunto de JSON Schema draft-07, sin dependencias. |

## Reglas transversales

- Ningún contrato admite campos de secreto, match, línea fuente, prompt o
  código (`FORBIDDEN_FIELDS` en `result.js`). El valor sensible nunca entra.
- `clock` e `idGenerator` son inyectables para pruebas deterministas.
- Los schemas versionados viven en `../../schemas/*.schema.json` y usan
  `additionalProperties: false`.

## Pruebas

La suite oficial está en `test/unit/*.test.js` y usa el runner nativo
`node --test`, que **requiere Node.js >= 18** (declarado en `package.json`).
En entornos con Node más antiguo el runner no está disponible.
