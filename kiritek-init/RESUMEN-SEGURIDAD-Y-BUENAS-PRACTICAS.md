# Seguridad y buenas prácticas en Kiritek: resumen

Resumen de los dos packs de protección que trae `kiritek-init`: **seguridad**,
que cuida secretos, ramas y commits, y **buenas prácticas de ingeniería**, que
cuida cómo se comporta el producto. Está escrito para entender qué hacen, por
qué importan y en qué estado están, sin entrar en el código. Para usarlos, ver
[MANUAL-DE-USO.md](MANUAL-DE-USO.md).

Estado al 19 de octubre de 2026.

---

## En una frase

Cuando alguien instala Kiritek en un repo, el repo queda con dos redes de
protección que **avisan** (y, cuando el equipo decide, **bloquean**) antes de
que un error llegue a producción. Una red evita filtrar credenciales o romper
ramas; la otra evita entregar software que se comporta mal.

## Los dos packs de un vistazo

| | Seguridad | Buenas prácticas |
|---|---|---|
| Qué protege | Secretos, ramas, historial de Git, commits y tickets | El comportamiento del producto: pantallas, formularios, APIs, servicios |
| Cómo decide | Con hechos verificables: hay un secreto o no, el commit tiene el formato o no | Con pruebas: el código del equipo se ejercita en un simulador y se mira qué hace |
| Dónde actúa | Antes del commit, antes del push, en CI y en los asistentes (Claude, Kiro) | En el editor, antes del commit, en el PR y en el release |
| Se instala | Siempre, en todo repo | Cuando el equipo lo pide (`guardrails install`) |
| Modo inicial | Aviso (no rompe repos existentes) | Aviso (nada bloquea por defecto) |
| Paso a bloquear | Lo decide el equipo, con revisión previa | Lo decide el equipo, control por control y unidad por unidad |

Los dos packs son **independientes**: cada uno tiene su configuración, sus
niveles, su instalación y su desinstalación. Desinstalar uno no toca el otro.

---

## Parte 1 — Seguridad

### Qué problema resuelve

Antes de este trabajo, Kiritek sólo comprobaba que ciertos archivos
existieran. No había detección de secretos ni hooks de Git, y las reglas de
Git ("no hagas push directo a main") eran consejos para el asistente, no algo
que se hiciera cumplir. El workflow semanal de auditoría incluso hacía push
directo desde CI.

### Qué hace ahora

| Protección | Qué evita | Cuándo actúa |
|---|---|---|
| **Detección de secretos** | Subir una clave, token o contraseña al repo | Antes del commit (lo que está en stage), antes del push (los commits que se van a enviar) y en CI (todo el repo y su historial) |
| **Archivos sensibles** | Subir `.env`, llaves privadas o certificados. Los `.env.example` con valores de ejemplo sí se permiten | Antes del commit y cuando el asistente quiere escribirlos |
| **Guardas de Git** | Push directo a la rama principal, push forzado peligroso y saltarse los hooks (`--no-verify`) | Antes del push y en los asistentes |
| **Formato de commits** | Mensajes que no siguen Conventional Commits | Al escribir el commit |
| **Tickets de Jira** | Commits que citan un ticket que no existe | Antes del push y en CI (opcional) |
| **Asistentes de IA** | Que Claude Code o Kiro escriban un secreto o ejecuten un comando Git peligroso | Antes de cada acción del asistente |
| **Auditoría** | Creer que algo está protegido cuando no lo está | Bajo demanda o en CI |
| **Respuesta a incidentes** | Improvisar cuando se filtra un secreto | Guías paso a paso: contener, rotar, evaluar uso, limpiar |
| **GitHub y AWS CodeCommit** (opcionales) | Configurar mal la protección de ramas en el proveedor | Genera un plan para revisar; **nunca aplica cambios en la nube por su cuenta** |

### Cómo se pensó

- **Honesto.** Nunca dice "verificado" sin una prueba reciente del mismo
  commit. Si algo no se puede comprobar (Jira caído, una fecha que no se
  conoce), lo dice: "no verificado".
- **No rompe lo existente.** En un repo que ya tenía hooks o configuraciones
  propias, las respeta y las encadena. Si algo está personalizado, deja una
  propuesta al lado en vez de pisarlo.
- **Reversible.** La instalación es todo o nada: si algo falla, vuelve atrás.
  La desinstalación saca sólo lo que Kiritek puso.
- **Privado.** Los reportes nunca muestran el valor de un secreto. Si un dato
  sensible llegara a colarse en un reporte, el reporte no se publica.
- **No juzga la autoría.** Kiritek **no** bloquea nada por "haber sido escrito
  por IA". Sólo evalúa hechos: secretos, archivos, formato y ramas.

### Límites que hay que tener claros

- **Los hooks locales se pueden saltar.** Corren en la máquina de cada
  persona. Son la primera línea, rápida; la protección definitiva está en CI y
  en el proveedor (GitHub, AWS).
- **Proteger la rama principal no protege las otras ramas.** Un secreto puede
  llegar a una rama de feature. Por eso el escaneo local, el de push y el de CI
  se complementan.
- **Borrar un commit no invalida una credencial filtrada.** Si un secreto llegó
  al remoto, hay que **rotarlo** con el proveedor. Es lo único que lo invalida.

### Estado

- Las 266 tareas del plan de seguridad están terminadas, en todas sus fases:
  cimientos, instalación, escaneo, CI, commits y Jira, asistentes, incidentes,
  proveedores y documentación.
- Arranca en modo **aviso**. Pasar a **bloqueo** es una decisión del equipo,
  con un chequeo previo (`security doctor`).
- Hay **un test del pack de seguridad que falla** (el 37.3) porque usa una
  fecha fija que ya venció. Es un arreglo chico, pero conviene que lo haga o
  apruebe el dueño del pack.

---

## Parte 2 — Buenas prácticas de ingeniería

### Qué problema resuelve

Muchas fallas de producto no son de seguridad, y no las atrapan ni los tests
unitarios ni el linter. Por ejemplo, un buscador que dispara una consulta por
tecla, una pantalla que queda en blanco cuando falla la red, una API que cobra
dos veces si el cliente reintenta, o un "borrar mi cuenta" que deja los datos
en otra tabla. Son fallas de **comportamiento**, y hasta ahora dependían de que
alguien se acordara de revisarlas.

### Cómo funciona

1. El equipo declara qué tipo de pieza es cada parte del repo: una web, una
   app móvil, una API, un servicio. A eso le llamamos **perfil**.
2. Para cada práctica que aplica, el equipo escribe un **contrato** corto (qué
   promete su código) y un **adaptador** (cómo conectar su código al
   simulador).
3. Kiritek ejercita ese código en un **simulador** con reloj y red falsos:
   corta la conexión, manda datos inválidos, reintenta, apaga el servicio a
   mitad de una request. Después mira qué hizo el código.
4. Si el código no cumple, avisa con el problema concreto y cómo arreglarlo.

No exige ninguna librería ni framework. Revisa **cómo se comporta** el
producto, no cómo está escrito.

### Las 35 prácticas

**De interfaz (17)**

| Práctica | Qué evita |
|---|---|
| Buscador responsable | Una consulta por tecla, resultados viejos encima de los nuevos |
| Versión mínima de la app | Usuarios atrapados en una versión que ya no se soporta, o bloqueados sin salida |
| Anuncio de módulos nuevos | Avisos que no se pueden cerrar con teclado o que aparecen una y otra vez |
| Estados de pantalla | Pantallas en blanco, "cargando" para siempre, una lista vacía que parece error |
| Formularios accesibles | Errores que un lector de pantalla no lee, perder lo escrito si falla el servidor |
| Llamadas de red resilientes | Esperas infinitas, reintentos que duplican cobros |
| Feature flags con vencimiento | Flags eternas, permisos que se abren si el proveedor de flags se cae |
| Sesión expirada | Bucles de renovación, perder el borrador al volver a iniciar sesión |
| Subida de archivos | Subir archivos gigantes o inválidos, no poder cancelar |
| Listas paginadas | Ítems repetidos o saltados, listas que nunca terminan |
| Eventos de analytics | Mandar el email del usuario, eventos dobles, que analytics rompa una compra |
| Acciones destructivas | Borrar al primer clic, cobrar dos veces |
| Formato por idioma | Fechas, números o montos en el formato de otro país |
| Modo sin conexión | Perder lo que hizo el usuario sin red, enviarlo dos veces al volver |
| Permisos del dispositivo | Pedir todo al abrir la app, romperse si el usuario dice que no |
| Rutas y enlaces rotos | Pantallas en blanco, enlaces que se pierden después del login |
| Diálogos accesibles | Foco que se escapa, Escape que no cierra, fondo que sigue activo |

**De backend: contrato de la API (11)**

| Práctica | Qué evita |
|---|---|
| Idempotencia | Que un reintento cree dos órdenes o cobre dos veces |
| Errores de API | 500 genéricos, errores que muestran el interior del sistema |
| Límite de uso | Que un cliente abusivo tumbe la API para todos |
| Paginación | Listados de un millón de filas, ítems repetidos entre páginas |
| Edición concurrente | Que el último en guardar borre sin aviso lo que guardó otro |
| Versionado | Romper apps viejas por renombrar un campo o quitar una versión sin aviso |
| Límites de tamaño y tiempo | Que un pedido gigante o una base lenta tumben el servicio |
| Caché HTTP | Datos privados en una caché compartida, datos viejos que no se actualizan |
| Respuestas según su schema | Documentación que no coincide con lo que la API responde |
| Operaciones largas | Clientes esperando minutos, reportes "en proceso" para siempre |
| Operaciones en lote | Lotes aplicados a medias, errores escondidos |

**De backend: operación del servicio (7)**

| Práctica | Qué evita |
|---|---|
| Dependencias caídas | Que la caída de una base o servicio externo cuelgue todo |
| Health checks y apagado | Cortar requests en cada deploy, mandar tráfico a un servicio que no está listo |
| Logs sin datos personales | Emails, tokens o contraseñas en los logs |
| Migraciones compatibles | Romper la versión que sigue corriendo durante el deploy |
| Borrado de datos del usuario | Que "borrar mi cuenta" deje datos en otra tabla o en un listado |
| Métricas del servicio | No saber qué ruta está lenta o falla, o un sistema de métricas desbordado |
| Configuración al arrancar | Servicios que arrancan "bien" y fallan en la primera request por una variable mal puesta |

### Cómo se pensó

- **Primero avisa.** Todo empieza en modo aviso, y nada bloquea por defecto.
- **Sólo bloquea con prueba objetiva.** Una sospecha (un nombre de archivo, un
  patrón en el código) nunca bloquea; sólo sugiere declarar el contrato.
  Bloquear exige una prueba que falla siempre igual, reciente y del cambio que
  se está revisando, y que el equipo haya activado el bloqueo para ese control.
- **No confunde una falla técnica con un incumplimiento.** Si el simulador no
  pudo correr, eso se informa como lo que es, nunca como "incumpliste".
- **Privado.** La evidencia sólo guarda números y verdadero/falso. Nunca
  guarda código, datos de usuarios, cuerpos de requests ni prompts.
- **Excepciones con fecha de vencimiento.** Se puede aceptar una deuda
  temporal o declarar que un control no aplica, siempre con dueño, aprobador,
  ticket y vencimiento. Nunca para todo el repo.
- **Independiente de seguridad.** No comparte configuración ni niveles con el
  pack de seguridad, y no lo modifica.

### Estado

| | |
|---|---|
| Prácticas | 35 (17 de interfaz y 18 de backend), todas probadas contra implementaciones correctas e incorrectas |
| Casos de prueba de las prácticas | 500, todos en verde |
| Tests del repo | 1496; pasan 1494. Fallan sólo el test 37.3 de seguridad y otro que falla por arrastre |
| Plataformas | macOS, Linux y Windows; Node 18, 20 y 22 |
| Modo actual | **Sólo avisa** |

Las 3 primeras prácticas están publicadas. Las 32 nuevas están listas en un
catálogo **en espera** (2.0.0), que se publica cuando pasa la revisión final.
La revisión final hoy da "bloqueado" por tres motivos, todos esperables:

1. Falta correr CI en Linux y Windows: se resuelve con un push de la rama.
2. Falta arreglar el test 37.3 de seguridad.
3. Las últimas fases (42 a 48) están sin commit.

---

## Qué sigue

1. Commit de las fases 42 a 48.
2. Decidir quién arregla el test 37.3 de seguridad: su dueño, o nosotros con
   su visto bueno.
3. Push de la rama para que CI corra en todas las plataformas.
4. Con todo en verde, aprobar el catálogo 2.0.0. A partir de ahí los equipos
   pueden adoptar las 35 prácticas y activar el bloqueo control por control.

### Pendientes menores

- Faltan comandos para validar waivers y "no aplica" por separado. Hoy se
  validan al correr la revisión.
- La spec de buenas prácticas menciona criterios globales G1 a G7 sin
  definirlos. Los deduje del plan de tareas y conviene confirmarlos.
- En los contratos de algunas prácticas, los ejemplos de cuerpo que escribe el
  equipo no pueden usar ciertos nombres de campo, como `query` o `payload`: el
  control fallaría con error en vez de evaluar. Es un arreglo chico.

---

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Manual de uso | [MANUAL-DE-USO.md](MANUAL-DE-USO.md) |
| Detalle de las buenas prácticas, fase por fase | [RESUMEN-ENGINEERING-GUARDRAILS.md](RESUMEN-ENGINEERING-GUARDRAILS.md) |
| Documentación de seguridad | `templates/core/security/docs/` (empezar por `SECURITY.md`) |
| Documentación de buenas prácticas | `docs/engineering/` (cada práctica en `docs/engineering/controls/`) |
| Specs | `.kiro/specs/kiritek-init-integral-security/` y `.kiro/specs/kiritek-engineering-guardrails/` |
