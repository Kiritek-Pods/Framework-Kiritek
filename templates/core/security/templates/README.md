# Plantillas mínimas de PR y ticket (core, provider-neutral)

Estas plantillas son **declarativas y neutrales respecto al proveedor**. El core
sólo define el contenido mínimo; no instala nada específico de GitHub, GitLab,
Jira ni AWS CodeCommit (esos packs de proveedor se construyen aparte, en las
tareas 38–41).

## Archivos

| Archivo | Propósito | Requisito |
|---|---|---|
| `PULL_REQUEST_TEMPLATE.md` | PR mínimo: ticket, resumen/riesgo, evidencia de pruebas/seguridad, impacto en secretos/datos y rollback cuando aplique. | 18.1 |
| `TICKET_TEMPLATE.md` | Ticket mínimo: objetivo, criterios de aceptación, riesgo/datos, dependencias y evidencia requerida. | 18.2 |

## Reglas obligatorias

- **Campos limitados:** cada plantilla contiene SÓLO sus secciones permitidas.
  No se agregan campos ni texto de relleno (18.1, 18.2).
- **`N/A` permitido:** cualquier campo que no aplique se marca `N/A — <razón
  breve>`; el sistema no exige relleno (18.4).
- **Sin datos sensibles:** las plantillas no solicitan secretos, dumps, tokens,
  credenciales, prompts completos ni logs sin redactar (18.3).
- **Verificación con evidencia:** una afirmación `verificado`/`tested`/`working`
  requiere evidencia vigente del mismo commit/alcance (18.5, Requisito 11). El
  validador `src/policy/evidence-declaration.js` reutiliza la lógica de frescura
  de `src/domain/evidence.js` y rechaza (fail-closed) una afirmación verificada
  sin evidencia fresca.

## Cómo las consumen los proveedores

El core no coloca estas plantillas en la ruta específica de ningún proveedor.
Cada pack de proveedor (tareas 38–41) decide dónde montarlas sin cambiar su
contenido:

- **GitHub:** copia/enlaza a `.github/PULL_REQUEST_TEMPLATE.md` y, para tickets,
  a `.github/ISSUE_TEMPLATE/`.
- **GitLab:** `.gitlab/merge_request_templates/` y `.gitlab/issue_templates/`.
- **AWS CodeCommit / otros:** se referencian desde la guía de contribución o la
  herramienta de PR del proveedor.

Los packs sólo deben **ubicar** las plantillas; cualquier edición de contenido
debe conservar las reglas de arriba (verificables por `template-lint.js`).
