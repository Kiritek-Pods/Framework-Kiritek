# Catálogo de remediaciones

> **Las heurísticas nunca bloquean.** Señales por nombres, rutas, AST o
> dependencias (`behavior-evidence-missing`, `policy-evidence-missing`,
> `launch-confirmation`) sólo producen `warn` pidiendo evidencia verificable,
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
