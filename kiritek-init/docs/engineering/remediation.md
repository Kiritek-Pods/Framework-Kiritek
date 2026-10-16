# Catálogo de remediaciones

> **Las heurísticas nunca bloquean.** Señales por nombres, rutas, AST o
> dependencias (`behavior-evidence-missing`, `policy-evidence-missing`,
> `launch-confirmation`, `states-confirmation`, `forms-confirmation`,
> `requests-confirmation`, `registry-confirmation`, `session-confirmation`,
> `uploads-confirmation`, `lists-confirmation`, `plan-confirmation`,
> `actions-confirmation`, `i18n-confirmation`, `offline-confirmation`,
> `permissions-confirmation`, `routes-confirmation`, `dialogs-confirmation`,
> `idempotency-confirmation`, `errors-confirmation`, `ratelimit-confirmation`,
> `pagination-confirmation`, `dependency-confirmation`, `health-confirmation`) sólo producen `warn` pidiendo evidencia verificable,
> en cualquier nivel. Sólo findings deterministas de contratos, manifests o
> tests conductuales pueden llegar a bloquear, y sólo en `enforce`.

Los ejemplos son neutrales al framework: describen el comportamiento esperado,
no una librería.

## `search.input-rate`

| Regla | Qué falló | Remediación | Ejemplo neutral |
|---|---|---|---|
| `cadence` | dos búsquedas a menos de `windowMs` | debounce, throttle o equivalente | esperar `windowMs` sin teclear antes de buscar |
| `minimum` | búsqueda con menos de `minChars` | no iniciar trabajo costoso bajo el mínimo, o declarar `minCharsException` con su test | `if (texto.trim().length < minChars) return` |
| `stale-order` | una respuesta vieja reemplazó resultados nuevos | descartar respuestas que no correspondan a la última consulta | guardar un número de secuencia y comparar al recibir |
| `cancellation` | la solicitud obsoleta no se canceló | cancelar (señal de aborto) al empezar una consulta nueva | abortar la anterior antes de enviar la nueva |
| `dedupe` | consultas equivalentes repetidas | cache o comparación normalizada dentro de `dedupeWindowMs` | normalizar (trim/minúsculas) y reutilizar |
| `propagation` | error oculto o cancelación mostrada como error | mostrar errores reales; ignorar cancelaciones | distinguir "abortado" de "falló" |
| `behavior-evidence-missing` (heurística) | hay búsqueda pero no contrato | declarar `behaviorContract` y adapter | — |

## `app.minimum-supported-version`

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corregir ruta, JSON y schema del contrato de política. |
| `contract-source-authenticity` | Fuente autenticable por entorno (firma con `keyId`, auth del proveedor o pinning). |
| `contract-environments` | Declarar la política para cada entorno configurado. |
| `contract-timeout` | Timeout de la fuente ≤ `parameters.timeoutMs`. |
| `contract-cache` | TTL/staleIfOffline dentro de los máximos configurados. |
| `contract-offline` | Política de primera ejecución offline igual a `firstRunOffline`. |
| `contract-grace` | Gracia con tiempo confiable (servidor o timestamp firmado) y duración máxima. |
| `contract-hard-exit` | El hard update explica el motivo y ofrece salida si el store no está. |
| `contract-soft` | El soft update permite continuar. |
| `contract-store-fallback` | Fallback alcanzable por store/plataforma. |
| `contract-rollback` | Revertir la política sin publicar la app (fuente remota, no embebida). |
| `contract-override` | Override autenticado, auditado, reversible, acotado por entorno y ≤ 168 h. |
| `contract-observability` | Eventos fetch/parse/cache/decision/store/override sin identificadores en claro. |
| `version-comparison` | Comparar con semver (prerelease < release; build metadata ignorada), nunca como texto: `1.10.0 > 1.9.0`. |
| `hard-flow` | Impedir continuar, explicar accesiblemente y mantener actualizar/salir. |
| `soft-flow` | Permitir continuar y posponer según la frecuencia declarada. |
| `untrusted-payload` | Política inválida o con firma inválida no se aplica; seguir la política de indisponibilidad. |
| `timeout` | Terminar dentro del timeout y aplicar la política offline; nunca quedar colgado. |
| `offline-policy` | Aplicar lo declarado para primera ejecución, cache válida y expirada. |
| `grace` | Usar el tiempo del servidor, no el reloj del dispositivo. |
| `store-fallback` | Store ausente ⇒ fallback declarado y salida; enterprise ⇒ su canal. |
| `rollback` | Revertir la política remota debe levantar el bloqueo sin nueva versión de app. |
| `override` | Sólo un override autenticado, vigente y del entorno correcto levanta el bloqueo. |
| `policy-evidence-missing` (heurística) | Declarar `policyContract` y ejecutar el harness. |

## `web.module-announcement`

| Regla | Remediación |
|---|---|
| `metadata-invalid` | Corregir ruta, JSON, ids únicos y schema del launch manifest. |
| `required-signal-missing` | Vincular el módulo a un anuncio existente o a un N/A gobernado. |
| `invalid-na` | N/A existente, del mismo módulo, vigente y, si es crítico, con segunda aprobación. |
| `window` | La ventana termina después de empezar. |
| `audience-pii` | Sólo criterios permitidos (rol, plan, región, cohorte…), sin emails, teléfonos ni ids de personas. |
| `channels-unsupported` | Usar canales soportados (`parameters.supportedChannels`) y declarados en el anuncio. |
| `channel-unreachable` | Cada audiencia con un canal soportado o `fallbackChannel`. |
| `content-localization` | `defaultLocale` dentro de los locales declarados. |
| `show-once-key` | Una clave show-once propia por anuncio. |
| `rollout-traceability` | Estado de rollout igual a la última entrada del historial, ordenado. |
| `show-once` | Deduplicar por clave/alcance/periodo y aplicar el tratamiento declarado sin storage, sin romper el módulo. |
| `rollout` | Pausar/retirar el anuncio no retira el módulo; reactivar vuelve a mostrarlo. |
| `targeting` | No mostrar fuera de la ventana ni a audiencias excluidas. |
| `keyboard` | Todos los controles alcanzables con Tab. |
| `focus` | Al abrir, foco en el anuncio o uno de sus controles. |
| `name-role-state` | Rol válido, nombre accesible, controles con nombre, estado coherente. |
| `close` | Cerrar con Escape y con un control, devolviendo el foco al origen. |
| `contrast` | Contraste del estándar adoptado (AA: 4.5:1 texto normal). |
| `reduced-motion` | Con `prefers-reduced-motion`, sin animación. |
| `localization` | Si falta el locale del usuario, usar el por defecto; nunca claves internas. |
| `content-fallback` | Fallback declarado; nunca clave interna, texto vacío ni markup roto. |
| `launch-confirmation` (heurística) | Confirmar el lanzamiento en el launch manifest. |

## `ui.data-states` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de estados (ruta, JSON, ids de pantalla únicos y schema ui-data-states.contract). |
| `contract-timeout` | El timeoutMs de la pantalla supera parameters.maxTimeoutMs: acórtelo para que el usuario no espere indefinidamente. |
| `loading-state` | Mientras los datos cargan, la pantalla debe mostrar un estado de carga (nunca en blanco ni contenido viejo sin indicarlo). |
| `loading-announced` | Anuncie la carga a tecnologías de asistencia (aria-busy, live region o equivalente de la plataforma). |
| `content-state` | Con datos, la pantalla debe mostrar el contenido con todos los ítems recibidos. |
| `empty-state` | Sin datos, muestre un estado vacío explícito (no una lista en blanco ni un error). |
| `error-state` | Si la carga falla, muestre un estado de error; nunca quede en blanco ni en carga infinita. |
| `retry-available` | El estado de error debe ofrecer una acción de reintento visible. |
| `retry` | Reintentar tras un error debe volver a cargar y mostrar el contenido. |
| `timeout` | Si la carga no responde dentro del timeoutMs declarado, pase a estado de error con reintento. |
| `duplicate-request` | Montar la pantalla debe disparar una sola carga (sin pedidos duplicados). |
| `states-confirmation` (heurística) | Declarar la pantalla en el contrato de estados (`statesContract`). |

## `ui.form-validation` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de formularios (ruta, JSON, ids y nombres de campo únicos, schema ui-form-validation.contract). |
| `contract-length` | minLength no puede ser mayor que maxLength en un mismo campo. |
| `blocks-invalid-submit` | No envíe el formulario mientras haya campos obligatorios vacíos o con formato inválido. |
| `required` | Marque como inválido cada campo obligatorio vacío al intentar enviar. |
| `format` | Valide el formato y largo declarados de cada campo (email, número, URL, teléfono, largo de texto). |
| `false-error` | No marque como inválido un campo con un valor válido. |
| `error-linked` | Asocie cada mensaje de error a su campo (aria-describedby o equivalente) para que el lector de pantalla lo lea. |
| `focus-first-invalid` | Al fallar el envío, lleve el foco al primer campo inválido. |
| `message-text` | Los mensajes de error deben ser texto legible: nunca vacíos, claves internas ni markup. |
| `submit` | Con todos los campos válidos, el formulario debe enviarse una vez, con los valores ingresados, y confirmar el envío. |
| `double-submit` | Evite envíos duplicados mientras un envío está en curso (deshabilite o ignore clics repetidos). |
| `preserve-input` | Si el envío falla, conserve lo que el usuario escribió. |
| `error-announced` | Si el envío falla, muestre y anuncie el error (live region o alerta) y deje el formulario en estado de error. |
| `resubmit` | Tras un error de envío, el usuario debe poder reenviar y completar el envío. |
| `error-clears` | Al corregir un campo, quite su error. |
| `forms-confirmation` (heurística) | Declarar el formulario en el contrato de formularios (`formsContract`). |

## `net.resilient-requests` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de llamadas (ruta, JSON, ids únicos y schema net-resilient-requests.contract). |
| `contract-timeout` | El timeoutMs de la operación supera parameters.maxTimeoutMs. |
| `contract-attempts` | maxAttempts supera parameters.maxAttempts: demasiados reintentos amplifican incidentes. |
| `contract-unsafe-retry` | Una operación no idempotente sin clave de idempotencia no puede reintentarse ante error de red o timeout (podría duplicar la operación). |
| `contract-backoff` | maxDelayMs no puede ser menor que baseMs. |
| `timeout` | Toda llamada debe terminar: aplique el timeout declarado aunque el servidor no responda. |
| `client-error-retry` | No reintente errores del cliente (4xx): falle de inmediato con un único intento. |
| `transient-retry` | Reintente fallas transitorias (5xx, red) según la política declarada hasta tener éxito. |
| `retry-limit` | Respete maxAttempts: no reintente indefinidamente ni más veces de lo declarado. |
| `backoff` | Espere entre reintentos según el backoff declarado (creciente si es exponencial, acotado por maxDelayMs). |
| `retry-after` | Ante 429, respete Retry-After antes de reintentar. |
| `idempotency` | Tras un error ambiguo en una operación no idempotente, no reintente o reintente con la misma Idempotency-Key. |
| `requests-confirmation` (heurística) | Declarar la operación en el contrato de llamadas (`clientContract`). |

## `flags.lifecycle` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el registro de flags (ruta, JSON, keys únicas y schema flags-lifecycle.contract). |
| `contract-timeout` | El timeout del cliente de flags supera parameters.maxClientTimeoutMs. |
| `remove-by-missing` | Toda flag de release o experimento necesita fecha de retiro (removeBy). |
| `flag-expired` | La flag pasó su fecha de retiro: elimínela del código y del registro, o extienda removeBy con justificación (waiver). |
| `flag-lifetime` | La vida de la flag (createdAt → removeBy) supera parameters.maxLifetimeDays: acorte el plazo o conviértala en flag de ops. |
| `unsafe-default` | Las flags de permiso deben tener defaultValue false: si el proveedor falla, nadie gana acceso. |
| `kill-switch-type` | Un kill switch debe ser booleano para poder apagarse sin ambigüedad. |
| `provider-value` | El cliente debe usar el valor que entrega el proveedor. |
| `fallback-default` | Si el proveedor falla, devuelva el defaultValue declarado sin lanzar. |
| `timeout` | Si el proveedor no responde dentro de client.timeoutMs, devuelva el defaultValue. |
| `invalid-value` | Si el proveedor devuelve un valor de tipo incorrecto, use el defaultValue. |
| `unknown-flag` | Una flag no registrada debe resolverse como apagada (false/null), nunca lanzar. |
| `propagation` | Un cambio en el proveedor debe verse dentro de client.refreshSeconds (kill switch efectivo). |
| `registry-confirmation` (heurística) | Declarar las flags en el registro (`flagRegistry`). |

## `auth.session-expiry` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de sesión (ruta, JSON y schema auth-session-expiry.contract). |
| `contract-refresh` | parameters.requireRefresh exige renovación de token: declare session.refresh = token-refresh. |
| `authenticated-request` | Con una sesión válida, el pedido debe salir una vez con el token actual y sin renovar. |
| `refresh-retry` | Ante un 401, renueve el token y repita el pedido una vez con el token nuevo. |
| `single-refresh` | Si varios pedidos reciben 401 a la vez, renueve el token una sola vez y reintente todos con él. |
| `no-loop` | Si la renovación falla o el token nuevo también da 401, no reintente más: deje de pedir. |
| `login-redirect` | Si la sesión no se puede renovar, lleve al usuario al login (no a un error genérico ni a una pantalla rota). |
| `preserve-work` | Al llevar al login, conserve lo que el usuario estaba haciendo (borrador) para recuperarlo después. |
| `session-confirmation` (heurística) | Declarar el contrato de sesión (`sessionContract`). |

## `ui.file-upload` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de subidas (ruta, JSON, ids únicos y schema ui-file-upload.contract). |
| `contract-size` | maxBytes supera parameters.maxBytesLimit: baje el límite o súbalo explícitamente en la configuración. |
| `contract-accept-any` | Aceptar cualquier tipo (*/*) exige parameters.allowAnyType: declare los tipos concretos que acepta. |
| `upload-complete` | Un archivo válido debe subirse una vez y terminar en estado completado. |
| `progress` | Muestre el progreso de la subida mientras ocurre. |
| `size-limit` | Rechace antes de subir los archivos que superan maxBytes, sin llamar al servidor. |
| `type-check` | Rechace antes de subir los tipos no aceptados, sin llamar al servidor. |
| `message-text` | Explique el rechazo con texto legible: nunca vacío, claves internas ni markup. |
| `cancel` | Permita cancelar una subida en curso: aborte la transferencia y deje el estado en cancelado. |
| `error-state` | Si la subida falla, muestre un estado de error (no quede subiendo para siempre). |
| `retry` | Tras un error, permita reintentar y completar la subida. |
| `duplicate-upload` | Ignore un segundo inicio mientras la subida está en curso (una sola transferencia). |
| `uploads-confirmation` (heurística) | Declarar la subida en el contrato de subidas (`uploadsContract`). |

## `ui.pagination` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de listas (ruta, JSON, ids únicos y schema ui-pagination.contract). |
| `contract-page-size` | pageSize supera parameters.maxPageSize: páginas grandes cargan de más. |
| `first-page` | Al montar, cargue sólo la primera página (una petición, pageSize ítems). |
| `page-size` | Pida exactamente pageSize ítems por página. |
| `complete` | Paginando hasta el final deben aparecer todos los ítems. |
| `duplicates` | No repita ítems al paginar. |
| `order` | Conserve el orden de la fuente al agregar páginas. |
| `end-state` | Indique cuando no hay más ítems (fin de la lista). |
| `extra-requests` | Use nextCursor/hasMore para saber cuándo terminar; no pida páginas de más. |
| `load-after-end` | Una vez en el fin de la lista, no vuelva a pedir páginas. |
| `concurrent-load` | Ignore un segundo 'cargar más' mientras hay una página en vuelo (sin duplicados). |
| `keep-on-error` | Si una página falla, conserve los ítems ya cargados. |
| `error-state` | Si una página falla, muéstrelo con opción de reintentar. |
| `retry` | Reintentar tras el error debe cargar la página que faltaba, sin duplicados. |
| `stable-cursor` | Pagine por cursor: si llegan ítems nuevos arriba, no repita ni salte ítems. |
| `lists-confirmation` (heurística) | Declarar la lista en el contrato de listas (`listsContract`). |

## `analytics.events` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el plan de tracking (ruta, JSON, nombres únicos y schema analytics-events.contract). |
| `pii-property` | El plan declara una propiedad con nombre de dato personal (email, teléfono, nombre…): quítela o use un identificador seudónimo. |
| `emitted-once` | Cada acción debe emitir su evento exactamente una vez. |
| `schema` | Envíe el evento con las propiedades obligatorias, del tipo declarado y con valores permitidos. |
| `unplanned-properties` | No envíe propiedades que no están en el plan de tracking. |
| `pii-leak` | No envíe datos personales del usuario (email, teléfono, nombre) en eventos de analytics. |
| `failure-isolation` | Si el envío de analytics falla, la acción del usuario debe seguir funcionando (no propague el error). |
| `duplicate-delivery` | Al reintentar envíos fallidos, no entregue el mismo evento dos veces. |
| `plan-confirmation` (heurística) | Declarar los eventos en el plan de tracking (`trackingPlan`). |

## `ui.destructive-actions` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de acciones destructivas (ruta, JSON, ids únicos y schema ui-destructive-actions.contract). |
| `contract-undo-window` | La ventana para deshacer (undoWindowMs) debe declararse y ser al menos parameters.minUndoWindowMs. |
| `confirmation` | Pida confirmación antes de ejecutar la acción destructiva; no ejecute al primer clic. |
| `dismiss` | Si el usuario cancela la confirmación, no ejecute nada. |
| `execute` | Confirmada (o vencida la ventana de deshacer), la acción debe ejecutarse una vez y mostrar el resultado con un mensaje legible. |
| `double-execution` | Ignore clics repetidos mientras la acción está en curso: debe ejecutarse una sola vez. |
| `undo` | Deshacer dentro de la ventana debe dejar todo como estaba (no ejecutar, o revertir). |
| `undo-window` | Pasada la ventana de deshacer, la acción debe quedar aplicada. |
| `error-state` | Si la acción falla, muéstrelo como error y no la dé por hecha. |
| `message-text` | Informe el resultado con texto legible: nunca vacío, claves internas ni markup. |
| `actions-confirmation` (heurística) | Declarar la acción en el contrato de acciones destructivas (`actionsContract`). |

## `i18n.formatting` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de localización (ruta, JSON y schema i18n-formatting.contract). |
| `contract-default-locale` | defaultLocale debe estar entre los locales declarados. |
| `date-format` | Formatee fechas según el idioma del usuario (orden de día y mes, año completo); use Intl.DateTimeFormat o equivalente. |
| `number-format` | Formatee números con los separadores del idioma (p. ej. 1.234.567,89 en es-CL; 1,234,567.89 en en-US). |
| `currency-format` | Muestre montos con la moneda (símbolo o código) y el formato del idioma. |
| `time-zone` | Formatee fechas en la zona horaria del usuario, no en UTC ni en la del servidor. |
| `locale-fallback` | Si el idioma del usuario no está soportado, use el idioma por defecto. |
| `missing-message` | Si falta una traducción, muestre un texto de respaldo legible, nunca la clave interna ni un texto vacío. |
| `formatter-error` | El formateador no debe lanzar errores con ningún idioma soportado. |
| `i18n-confirmation` (heurística) | Declarar el contrato de localización (`i18nContract`). |

## `app.offline-mode` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de modo sin conexión (ruta, JSON, ids únicos y schema app-offline-mode.contract). |
| `offline-indicator` | Avise mientras no hay conexión y quite el aviso cuando vuelve. |
| `online-send` | Con conexión, la acción debe enviarse una vez y confirmarse. |
| `offline-accept` | Sin conexión, acepte la acción (encolada) sin mostrar error al usuario. |
| `sync-once` | Al volver la conexión, envíe cada acción encolada exactamente una vez. |
| `queue-drain` | Tras sincronizar, la cola debe quedar vacía. |
| `persist-queue` | Guarde la cola en almacenamiento persistente: debe sobrevivir a cerrar y abrir la app. |
| `sync-order` | Sincronice las acciones en el orden en que el usuario las hizo. |
| `online-only` | Una acción que sólo funciona con conexión debe rechazarse sin red (y no enviarse después a escondidas). |
| `offline-confirmation` (heurística) | Declarar el contrato de modo sin conexión (`offlineContract`). |

## `app.device-permissions` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de permisos (ruta, JSON, ids únicos y schema app-device-permissions.contract). |
| `ask-in-context` | No pida permisos al abrir la app: pídalos cuando el usuario usa la funcionalidad que los necesita. |
| `rationale` | Explique para qué necesita el permiso antes de pedirlo. |
| `granted-flow` | Con el permiso concedido, la funcionalidad debe funcionar a la primera. |
| `denied-keeps-working` | Si el usuario niega el permiso, la app debe seguir funcionando (sin error ni bloqueo). |
| `denied-fallback` | Si el permiso se niega, ofrezca la alternativa declarada (p. ej. escribir la dirección a mano). |
| `no-reprompt` | No vuelva a pedir un permiso ya negado cada vez que se usa la funcionalidad. |
| `settings-link` | Si el permiso está bloqueado, ofrezca ir a los ajustes del sistema en vez de pedirlo de nuevo. |
| `permissions-confirmation` (heurística) | Declarar los permisos en el contrato (`permissionsContract`). |

## `nav.broken-routes` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de rutas (ruta del archivo, JSON, rutas únicas y schema nav-broken-routes.contract). |
| `route-match` | Una ruta declarada debe abrir su pantalla. |
| `not-found-page` | Una ruta inexistente debe mostrar una página de 'no encontrado', no una pantalla en blanco ni un error. |
| `exit-link` | La página de 'no encontrado' debe ofrecer una salida (ir al inicio o volver). |
| `malformed-url` | Una URL mal formada no debe romper la app: muestre 'no encontrado' o la ruta válida más cercana. |
| `auth-redirect` | Un enlace a una ruta protegida sin sesión debe llevar al login. |
| `return-after-login` | Después del login, lleve al usuario al destino del enlace original. |
| `keep-query` | Conserve los parámetros del enlace original (p. ej. ?tab=) al volver del login. |
| `routes-confirmation` (heurística) | Declarar las rutas en el contrato (`routesContract`). |

## `ui.accessible-dialogs` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de diálogos (ruta, JSON, ids únicos y schema ui-accessible-dialogs.contract). |
| `focus-in` | Al abrir, lleve el foco al diálogo o a su primer control. |
| `focus-trap` | Mientras el modal o panel está abierto, Tab y Shift+Tab deben quedar dentro. |
| `escape-close` | Escape debe cerrar un diálogo descartable (y no cerrar uno que no lo es). |
| `focus-return` | Al cerrar, devuelva el foco al botón que lo abrió. |
| `outside-click` | Clic afuera debe cerrar un diálogo descartable y no cerrar uno que no lo es. |
| `role` | Use el rol correcto (dialog/alertdialog con aria-modal en modales; menu en menús). |
| `accessible-name` | Dé al diálogo un nombre accesible (aria-labelledby o aria-label). |
| `background-inert` | Con un modal o panel abierto, el fondo no debe poder usarse (inert o aria-hidden). |
| `dialogs-confirmation` (heurística) | Declarar los diálogos en el contrato (`dialogsContract`). |

## `api.idempotency` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de idempotencia (ruta, JSON, ids únicos y schema api-idempotency.contract). |
| `single-execution` | Repetir un pedido con la misma clave de idempotencia no debe ejecutar el efecto otra vez. |
| `replay-same-response` | Un pedido repetido con la misma clave debe devolver la misma respuesta (estado y cuerpo) que el original. |
| `concurrent-single-execution` | Dos pedidos simultáneos con la misma clave deben ejecutar el efecto una sola vez (bloqueo o restricción única), sin error 5xx. |
| `distinct-keys` | Claves distintas son pedidos distintos: cada uno debe ejecutarse. |
| `key-mismatch` | Reutilizar una clave con otro cuerpo debe rechazarse (409/422), sin ejecutar nada. |
| `key-required` | Si la clave es obligatoria, rechace (400/428) los pedidos sin ella, sin ejecutar nada. |
| `idempotency-confirmation` (heurística) | Declarar el contrato (`idempotencyContract`). |

## `api.error-responses` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de errores (ruta, JSON, ids únicos y schema api-error-responses.contract). |
| `contract-error-fields` | Con errorFormat custom, declare errorFields (los campos que todo error debe traer). |
| `validation-status` | Una entrada inválida debe responder 400 o 422, nunca 2xx ni 5xx. |
| `malformed-body` | Un cuerpo JSON mal formado debe responder 400, no 500. |
| `not-found-status` | Una ruta inexistente debe responder 404. |
| `internal-status` | Una falla interna debe responder 5xx controlado (no colgarse ni devolver 2xx). |
| `error-format` | Todos los errores deben seguir el formato declarado (application/problem+json o los campos de errorFields). |
| `no-internal-details` | Nunca exponga stack traces, rutas del servidor, SQL, IPs internas ni mensajes de dependencias en la respuesta. |
| `errors-confirmation` (heurística) | Declarar el contrato (`errorsContract`). |

## `api.rate-limit` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de límites (ruta, JSON, ids únicos y schema api-rate-limit.contract). |
| `under-limit` | Dentro del límite declarado, los pedidos no deben recibir 429. |
| `limit-enforced` | Superado el límite dentro de la ventana, responda 429. |
| `retry-after` | Junto con el 429, envíe Retry-After (segundos, entre 1 y la ventana). |
| `per-client` | Cuente el límite por cliente (clave, IP o usuario declarado): que un cliente lo agote no debe bloquear a otro. |
| `window-reset` | Pasada la ventana, el cliente debe poder volver a usar la API. |
| `ratelimit-confirmation` (heurística) | Declarar el contrato (`rateLimitContract`). |

## `api.pagination` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de paginación (ruta, JSON, ids únicos y schema api-pagination.contract). |
| `contract-page-size` | maxPageSize supera parameters.maxPageSizeLimit, o defaultPageSize es mayor que maxPageSize. |
| `default-page-size` | Sin parámetros, el listado debe devolver defaultPageSize ítems. |
| `max-page-size` | Un limit mayor al máximo debe recortarse a maxPageSize o rechazarse con 4xx. |
| `complete` | Recorriendo todas las páginas deben aparecer todos los ítems. |
| `duplicates` | No repita ítems entre páginas. |
| `order` | Conserve un orden estable entre páginas. |
| `end-detection` | Indique el final (cursor nulo o página incompleta) para no obligar a pedir de más. |
| `invalid-limit` | Un limit negativo o no numérico debe responder 4xx o usar el valor por defecto, nunca 5xx. |
| `stable-cursor` | Pagine por cursor: si llegan ítems nuevos, no repita ni salte ítems. |
| `invalid-cursor` | Un cursor inválido debe responder 400, no 500 ni una página arbitraria. |
| `pagination-confirmation` (heurística) | Declarar el contrato (`paginationContract`). |

## `svc.dependency-failure` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de dependencias (ruta, JSON, ids únicos y schema svc-dependency-failure.contract). |
| `contract-timeout` | El timeoutMs de la dependencia supera parameters.maxTimeoutMs: las requests quedarían esperando demasiado. |
| `healthy-path` | Con todas las dependencias sanas, el endpoint debe responder 2xx. |
| `dependency-timeout` | Si una dependencia se cuelga, corte la espera en su timeoutMs y responda; nunca deje la request colgada. |
| `failure-response` | Si una dependencia falla, responda 503/504 controlado (o degradado 2xx si así se declaró), no 500 ni una excepción. |
| `circuit-breaker` | Tras fallas repetidas, deje de llamar a la dependencia caída por un tiempo (circuit breaker). |
| `breaker-recovery` | Cuando la dependencia se recupera, el corte debe cerrarse y el endpoint volver a responder 2xx. |
| `dependency-confirmation` (heurística) | Declarar el contrato (`dependencyContract`). |

## `svc.health-shutdown` (catálogo 2.0.0)

| Regla | Remediación |
|---|---|
| `contract-invalid` | Corrija el contrato de salud y apagado (ruta, JSON y schema svc-health-shutdown.contract). |
| `contract-grace` | shutdownGraceMs supera parameters.maxGraceMs: el orquestador mataría el proceso antes de terminar. |
| `liveness` | La ruta de liveness debe responder 2xx mientras el proceso funciona. |
| `readiness` | La ruta de readiness debe responder 2xx cuando las dependencias están sanas. |
| `readiness-checks-deps` | Si una dependencia declarada no responde, readiness debe responder 503 para que no le manden tráfico. |
| `liveness-independent` | Liveness no debe depender de las dependencias: si la base cae, reiniciar el proceso no lo arregla. |
| `drain-in-flight` | Al apagar, termine las requests en curso antes de cerrar. |
| `not-ready-on-shutdown` | Al empezar el apagado, readiness debe dejar de responder 2xx. |
| `reject-new-work` | Durante el apagado, rechace las requests nuevas (503) en vez de aceptarlas a medias. |
| `shutdown-completes` | El apagado debe terminar (cerrar conexiones y resolver) dentro del tiempo de gracia. |
| `grace-period` | Si hay trabajo que no termina, el apagado debe forzarse al vencer el tiempo de gracia, no quedar colgado. |
| `health-confirmation` (heurística) | Declarar el contrato (`healthContract`). |
