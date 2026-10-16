# Changelog — `engineering/guardrails`

Versiones del pack y de su catálogo. El catálogo es inmutable por versión y
sigue semver: major para contratos, enforcement o retiros; minor para
añadidos y defaults; patch sin cambios semánticos.

## Catálogo 2.0.0 — candidato (gate T17)

Estado: **candidato**, en `release/candidates/engineering/guardrails/2.0.0`.
Se publica en `catalogs/` sólo cuando el gate de release queda `ready`
(ver [release.md](release.md)). Mientras tanto el pack es warning-only.

- Veinticinco controles nuevos, cada uno con su perfil explícito, contrato,
  harness conductual y suite R27:
  - `ui.data-states` (`data-views`): carga, contenido, vacío, error con
    reintento, timeout y sin pedidos duplicados.
  - `ui.form-validation` (`forms`): obligatorios, formato, errores
    asociados al campo, foco al primer error, doble envío y no perder lo escrito.
  - `net.resilient-requests` (`network-client`): timeout, reintentos
    sólo seguros, backoff, `Retry-After` e idempotencia.
  - `flags.lifecycle` (`feature-flags`): registro con dueño, fecha de
    retiro y default seguro; cliente con fallback, timeout y propagación.
  - `auth.session-expiry` (`auth-session`): renovación única, sin bucles,
    login sin perder el trabajo.
  - `ui.file-upload` (`file-upload`): tamaño y tipo antes de subir,
    progreso, cancelar, reintentar y sin subidas dobles.
  - `ui.pagination` (`paginated-lists`): páginas sin duplicados ni saltos,
    orden, fin de lista, errores sin perder lo cargado y cursor estable.
  - `analytics.events` (`analytics`): esquema, una vez, sin datos
    personales y sin romper la app si el envío falla.
  - `ui.destructive-actions` (`destructive-actions`): confirmar o deshacer,
    cancelar no ejecuta, ejecución única y errores claros.
  - `i18n.formatting` (`localized`): fechas, números y montos por idioma,
    zona horaria del usuario e idioma de respaldo.
  - `app.offline-mode` (`offline-capable`): aviso, cola persistente,
    sincronización única y en orden; acciones online-only rechazadas.
  - `app.device-permissions` (`device-permissions`): pedir en contexto,
    explicar, seguir funcionando si se niega, no insistir, ir a ajustes.
  - `nav.broken-routes` (`routed-app`): "no encontrado" con salida, URLs
    mal formadas y destino conservado tras el login.
  - `ui.accessible-dialogs` (`dialogs`): foco, teclado, Escape, rol,
    nombre y fondo inerte.
  - Backend: `api.idempotency`, `api.error-responses`, `api.rate-limit`,
    `api.pagination`, `api.concurrency`, `api.versioning`,
    `api.request-limits` y `api.http-cache` (`http-api`);
    `svc.dependency-failure`, `svc.health-shutdown` y `svc.log-hygiene`
    (`backend-service`). El adapter conecta el handler
    HTTP o el servidor real en proceso con dependencias sintéticas; la traza
    sólo admite booleanos y números (schema `facts.trace`).
- Los veintiocho controles declaran `enforce` con `enforcementContract` ligado a
  su suite R27 (`kiritek/engineering/<control>@1.0.0`): evidencia sólo
  `deterministic`, momentos sólo `pr` y `release`.
- Los tres controles iniciales no cambian de comportamiento ni de nivel por
  defecto (`warn`) y siguen en versión `1.0.0`: los waivers vigentes no se
  reactivan. Los controles nuevos sólo aplican a unidades que declaren su
  perfil, y `update` los deja en `off` en instalaciones existentes.
- Migración 1.0.0 → 2.0.0 sin cambios de configuración; rollback a 1.0.0
  exige volver antes los controles promovidos a `warn`.

## Pack 0.1.0 — catálogo 1.0.0

Primera versión. Todo en `off|warn`; ningún control puede bloquear.

- Contratos, schemas y separación total de `core/security`.
- Perfiles `web`, `mobile-app`, `search`, `module-launch`; unidades y
  alcance de monorepo; configuración con precedencia flag > env > unidad >
  repo > catálogo.
- Pipeline común con predicado anti-deny: heurísticas, timeouts, conflictos,
  evidencia vencida y errores operativos nunca bloquean.
- Controles `search.input-rate`, `app.minimum-supported-version` y
  `web.module-announcement` con harness conductual (dos corridas).
- Waivers y N/A gobernados (expiración, aprobación, reactivación, deuda).
- Superficies: Kiro, Claude, pre-commit componible y CI provider-neutral.
- Auditoría por unidad × control × momento, `doctor`/`promote` con registro
  de promociones, telemetría opt-in.
- Plugins namespaceados con digest y sandbox (Node ≥ 22).
- install/update/migrate/uninstall transaccionales con backup y rollback.
- Suites de conformidad R27 empaquetadas.
