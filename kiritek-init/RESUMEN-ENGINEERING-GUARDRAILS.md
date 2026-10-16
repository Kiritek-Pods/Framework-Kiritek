# Engineering Guardrails: qué se hizo

Resumen del trabajo sobre la spec `kiritek-engineering-guardrails`, en `kiritek-init`. Al 15 de octubre de 2026 están terminadas las fases 1 a 15 y 17 a 37. La fase 16 (la revisión final antes de publicar) está construida, pero todavía no aprueba el pack.

---

## En una frase

Construimos un sistema que revisa automáticamente, en cada cambio de código, veinticuatro buenas prácticas de producto, de interfaz y de backend. Por ahora sólo avisa. Más adelante podrá bloquear, pero únicamente cuando la prueba sea objetiva y alguien lo active a propósito.

## El trabajo en números

| | Cantidad |
|---|---|
| Buenas prácticas revisadas | 24 (17 de interfaz y 7 de backend) |
| Fases | 37 (más de 185 subtareas de la spec) |
| Código del pack | ~30.300 líneas |
| Tests del pack | 74 archivos, ~10.000 líneas |
| Tests del repo completo | 1363 |
| Casos de las suites de conformidad | 330 (entre 11 y 18 por práctica) |
| Casos de prueba con datos al azar | más de 10.000 por corrida |
| Documentación para usuarios | 12 documentos |
| Formatos de datos validados | 24 |
| Lugares donde corre | 5: agente Kiro, agente Claude, antes del commit, PR y release |
| Plataformas | macOS, Linux y Windows; Node 18, 20 y 22 |

## Las veinticuatro buenas prácticas que revisa

### De interfaz (web y móvil)

| Práctica | Qué verifica | Ejemplo de error que detecta |
|---|---|---|
| **Buscador responsable** | que un buscador no dispare una consulta por cada tecla | busca con 1 letra, manda consultas repetidas o muestra resultados viejos encima de los nuevos |
| **Versión mínima de la app móvil** | que la app sepa pedir al usuario que actualice cuando su versión ya no se soporta | compara versiones como texto ("1.10" < "1.9"), deja al usuario bloqueado sin salida o se cae sin conexión |
| **Anuncio de módulos web nuevos** | que, cuando se lanza una sección nueva, se avise al usuario de forma clara y accesible | el aviso no se puede cerrar con teclado, aparece una y otra vez o tiene poco contraste |
| **Estados de pantalla** | que toda pantalla que pide datos muestre carga, contenido, vacío y error con reintento | queda en blanco mientras carga, una lista vacía parece un error o se queda "cargando" para siempre |
| **Formularios accesibles** | que los formularios validen, muestren errores que un lector de pantalla pueda leer y no pierdan lo escrito | se envía con campos vacíos, el error no está ligado al campo o un fallo del servidor borra todo lo escrito |
| **Llamadas de red resilientes** | que las llamadas a APIs no se cuelguen, reintenten sólo cuando es seguro y no dupliquen operaciones | se queda esperando para siempre, reintenta un error 400 o cobra dos veces al reintentar |
| **Feature flags con vencimiento** | que cada flag tenga dueño, fecha de retiro y valor por defecto seguro, y que el cliente aguante una caída del proveedor | flags vencidas que siguen vivas, un permiso que se abre si el proveedor falla o un "apagado de emergencia" que nunca llega |
| **Sesión expirada** | que una sesión vencida se renueve una sola vez o lleve al login sin perder lo que el usuario estaba haciendo | bucles de renovación, una renovación por cada pedido, pantalla de error en vez de login o un borrador perdido |
| **Subida de archivos** | que se rechace lo inválido antes de subir, se vea el progreso y se pueda cancelar y reintentar | sube archivos gigantes o de cualquier tipo, no muestra progreso, no se puede cancelar o sube dos veces |
| **Listas largas paginadas** | que las listas carguen por páginas sin repetir, saltar ni desordenar ítems | ítems duplicados, sin "fin de la lista", sigue pidiendo después del final o borra todo si una página falla |
| **Eventos de analytics** | que cada evento siga su esquema, salga una sola vez, sin datos personales y sin romper la app si falla el envío | envía el email del usuario, eventos dobles, propiedades fuera del plan o la compra falla porque analytics se cayó |
| **Acciones destructivas** | que borrar, cancelar o pagar pida confirmación o permita deshacer, y nunca se ejecute dos veces | borra al primer clic, "cancelar" igual borra, cobra dos veces o muestra "listo" cuando falló |
| **Formato por idioma** | que fechas, números y montos se vean según el idioma y país del usuario, en su zona horaria | "3/4/2026" para un chileno, "1,234.56" en vez de "1.234,56", montos sin moneda o la fecha de otro día por usar UTC |
| **Modo sin conexión** | que sin red la app avise, guarde lo que hace el usuario y lo sincronice una vez y en orden al volver | muestra error en vez de guardar, pierde la cola al cerrar la app, envía dos veces o "paga" sin conexión |
| **Permisos del dispositivo** | que cámara, ubicación o notificaciones se pidan al usarlas, con explicación, y que un "no" no rompa la app | pide todo al abrir, pide sin explicar, muestra error si se niega o insiste una y otra vez |
| **Rutas y enlaces rotos** | que una ruta inexistente muestre una página clara con salida y que un enlace sobreviva al login | pantalla en blanco, URL rara que rompe la app, después del login te manda al inicio en vez de al enlace |
| **Diálogos accesibles** | que modales y menús se puedan usar con teclado y lector de pantalla | el foco no entra o se escapa, Escape no cierra, el foco se pierde al cerrar o el fondo sigue activo |

### De backend (APIs y servicios)

| Práctica | Qué verifica | Ejemplo de error que detecta |
|---|---|---|
| **Idempotencia de la API** | que repetir un pedido (reintento, doble clic, timeout) no ejecute su efecto dos veces | dos pedidos iguales crean dos órdenes o cobran dos veces |
| **Errores de API** | que los errores tengan el código y el formato correctos y no muestren el interior del sistema | un JSON mal armado da 500, o el error muestra el stack trace, la IP de la base o la consulta SQL |
| **Límite de uso** | que la API frene a un cliente abusivo con 429 sin afectar a los demás | sin límite, un contador global que bloquea a todos o una ventana que nunca se reinicia |
| **Paginación de la API** | que los listados estén acotados y no repitan ni salten datos | devuelve un millón de filas, repite ítems entre páginas o un cursor inválido da 500 |
| **Dependencias caídas** | que la caída de una base o servicio externo no cuelgue todo el sistema | requests colgadas para siempre, 500 genérico o seguir golpeando a un servicio que está caído |
| **Health checks y apagado** | que el orquestador sepa cuándo mandar tráfico y que un despliegue no corte requests | "ready" con la base caída, reinicios en cadena o requests cortadas a mitad en cada deploy |
| **Logs sin datos personales** | que los logs sean estructurados, lleven un id por request y nunca guarden datos personales ni secretos | el email, el token o la contraseña del usuario en los logs, o logs en texto suelto imposibles de buscar |

Las tres primeras vienen desde el catálogo 1.0.0. Las otras veintiuna llegan con el catálogo 2.0.0 y sólo se revisan en las partes del repo que declaren el perfil correspondiente.

No exige usar ninguna librería ni framework en particular. Revisa **cómo se comporta** el producto, no cómo está escrito.

## Principios que se respetaron en todo

- **Separado de seguridad.** Tiene su propia configuración, sus propios niveles y su propia instalación y desinstalación. No toca nada del pack de seguridad.
- **Primero avisa.** Todo empieza en modo aviso, y nada bloquea por defecto.
- **Sólo bloquea con prueba objetiva.** Una sospecha (un nombre de archivo, un patrón en el código) nunca bloquea. Sólo puede bloquear un test que falla siempre igual, es reciente y corresponde al cambio que se está revisando.
- **No confunde fallas técnicas con incumplimientos.** Si una herramienta no está disponible o algo se demora, eso no es "incumpliste": se informa como lo que es.
- **Privacidad.** Nunca guarda código, búsquedas de usuarios, prompts ni datos personales.
- **Todo es reversible.** Instalar, actualizar, activar el bloqueo, volver atrás y desinstalar tienen respaldo y marcha atrás.

## Veinticuatro prácticas, una plataforma para todas

Es como un sistema de alarmas de un edificio: la central, el cableado, los avisos y el registro de quién la activa son lo grande; los sensores se enchufan.

- **Los sensores** son las veinticuatro prácticas.
- **La central** es todo lo demás:
  - correr la revisión en el editor, en el commit, en el PR y en el release;
  - decidir si avisa o bloquea;
  - las excepciones con vencimiento y la auditoría;
  - la privacidad;
  - instalar, actualizar y volver atrás.

Por eso las últimas veintiún prácticas salieron mucho más rápido que las tres primeras: usan un esqueleto común y sólo hubo que escribir lo propio de cada una (qué se declara, qué escenarios se prueban y qué reglas se aplican). Otros equipos pueden sumar las suyas como plugin, sin tocar nuestro código.

---

## Qué se hizo, fase por fase

### Fase 1: las reglas del juego
**Qué:** definimos el formato de todo lo que el sistema lee y produce: configuración, resultados y evidencia. También dejamos el pack aislado del de seguridad desde el diseño.

**Por qué importa:** todas las piezas (controles, agentes, CI, auditoría) hablan el mismo idioma. Si un dato viene mal armado, se rechaza en la entrada y no termina en un resultado equivocado.

### Fase 2: catálogo y configuración
**Qué:**
- Un **catálogo versionado** de controles, del que cada repo fija una versión exacta.
- **Configuración por repo**, donde siempre se puede rastrear de dónde salió cada valor.

**Por qué importa:** el resultado es el mismo en la máquina de cualquiera y en CI. Así se termina el "en mi máquina pasa". Y cuando alguien pregunta por qué un control está en tal nivel, la respuesta está a la vista.

### Fase 3: perfiles y monorepos
**Qué:**
- Cada parte del repo declara qué es: web, app móvil, buscador o lanzamiento de módulo.
- En monorepos se sabe exactamente qué código es de quién y qué partes afecta cada cambio.

**Por qué importa:** no se le exige a una API lo que es de una app móvil. Y un cambio en código compartido no se escapa sin revisión por "no ser de nadie".

### Fase 4: el motor común
**Qué:** un solo motor ejecuta todas las revisiones. Incluye un filtro final que **impide bloquear** si la evidencia no es objetiva, aunque un control lo pida por error.

**Por qué importa:** es la red de seguridad más importante del sistema. Aunque un control nuevo o de terceros venga mal hecho, no puede frenar el trabajo de nadie con una sospecha.

### Fase 5: ejecución segura, privacidad y caché
**Qué:**
- Revisiones aisladas, con límite de tiempo según el momento: rápido en el editor, más tiempo en PR o en release.
- Se borra cualquier dato sensible antes de guardar nada.
- Una caché evita repetir trabajo y se invalida sola cuando algo relevante cambia.

**Por qué importa:**
- Sin límites ni caché, revisar cada commit tardaría minutos y la gente lo desactivaría.
- Sin el borrado de datos sensibles, los reportes podrían filtrar búsquedas de usuarios o pedazos de código.

### Fase 6: comandos e instalación
**Qué:** comandos `kiritek-init guardrails …` para instalar, revisar y desinstalar. La instalación es todo-o-nada. (Esta fase la hizo otra sesión de trabajo.)

**Por qué importa:** si la instalación falla a mitad, el repo queda exactamente como estaba, sin archivos sueltos ni configuración rota.

### Fases 7, 8 y 9: los tres primeros controles
**Qué:** para cada práctica, un simulador que prueba el comportamiento real con un reloj controlado. Cada escenario se corre **dos veces**. Cada control trae ejemplos buenos y malos y su documentación.

**Por qué importa:**
- El reloj controlado hace que una prueba de "esperar 300 ms" dé siempre lo mismo, sin depender de la velocidad de la máquina.
- La doble corrida descarta resultados al azar: si una prueba da distinto entre corridas, se marca como inestable y nunca bloquea.

### Fase 10: excepciones controladas
**Qué:**
- **Waivers:** "sé que esto falla, lo arreglamos antes de tal fecha". Tienen dueño, motivo, aprobación y vencimiento (máximo 90 días).
- **No aplica:** "esto no corresponde acá", con justificación y revisión periódica (máximo 365 días).
- Si una excepción vence o cambia el control, la revisión vuelve a activarse sola, y la deuda queda visible en los reportes.

**Por qué importa:** siempre hay casos legítimos para saltarse una regla. Lo peligroso es que la excepción se vuelva permanente y nadie se acuerde. Así cada excepción tiene fecha de vencimiento y alguien que responde por ella.

### Fase 11: dónde corre
**Qué:** la misma revisión funciona en cinco lugares:
- en el **agente de IA**, con Kiro y con Claude;
- **antes de cada commit**, conviviendo con otros hooks que ya existan;
- en **PR** y **release**, con una plantilla de CI que sirve para cualquier proveedor.

**Por qué importa:**
- El aviso llega lo antes posible: mientras la IA escribe el código, no tres días después en el PR.
- Como todos los lugares usan el mismo motor, no hay reglas distintas según dónde se revise.
- Los hooks del equipo que ya existían siguen funcionando.

### Fase 12: auditoría y observabilidad
**Qué:**
- **Auditoría honesta:** para cada parte del repo y cada control, dice si de verdad está corriendo, apagado, sin datos, desactualizado o verificado.
- **`doctor`:** dice si un control está listo para pasar a bloquear y, si no, qué falta.
- **Telemetría** opcional y sin datos sensibles.

**Por qué importa:**
- Lo más peligroso de un sistema de control es creer que te protege cuando en realidad no está corriendo. La auditoría nunca muestra "todo bien" sin prueba.
- `doctor` evita activar un bloqueo que no está listo.

### Fase 13: extensiones (plugins)
**Qué:** otros equipos pueden agregar sus propios controles como plugins. Cada plugin queda fijado con una huella digital y corre en una zona aislada (requiere Node 22 o superior).

**Por qué importa:** el sistema crece sin que todo pase por nosotros. Un plugin modificado se detecta, y aunque sea malicioso no puede leer archivos que no le corresponden ni conectarse a internet sin permiso.

### Fase 14: actualizaciones, compatibilidad y documentación
**Qué:**
- **Actualizar** el catálogo: respaldo, aplicación, verificación y, si algo sale mal, vuelta atrás. Nunca activa bloqueos nuevos por su cuenta.
- **Desinstalar** quita sólo lo de este pack, y puede borrar también la evidencia guardada.
- **Matriz de compatibilidad:** macOS y Linux completos; en Windows funciona todo menos los hooks locales.
- **Documentación completa:** cómo funciona, configuración, guías de adopción, qué hacer ante cada problema y cómo arreglar cada regla.

**Por qué importa:**
- Una actualización nunca puede empezar a bloquear a un equipo de la noche a la mañana.
- Cada usuario sabe qué esperar según su sistema operativo.
- Ante un problema, la respuesta está escrita y no depende de preguntarle a alguien.

### Fase 15: pruebas de que se puede confiar
**Qué:**
- **Suites de conformidad** para los tres controles (11, 13 y 18 casos), que prueban que cada control distingue bien lo bueno de lo malo.
- **Pruebas masivas con datos al azar:** miles de casos de rutas, configuraciones, excepciones y monorepos.
- Se comprobó que **nada dudoso bloquea nunca**, y que bloquear sólo pasa tras activarlo a propósito, con vuelta atrás inmediata.
- **Barrido de privacidad** de cada salida y cada archivo guardado. Encontró y arreglamos una filtración propia: rutas completas de la máquina en los respaldos.
- **Registro de activaciones:** quién activó un bloqueo, cuándo, desde dónde y qué cambió.
- **CI para todas las plataformas.**

**Por qué importa:** es la diferencia entre "creemos que funciona" y "está demostrado". Antes de permitir que algo frene a un equipo, hay pruebas de que sólo frena cuando corresponde, y de que siempre se sabe quién lo activó.

### Fase 16: revisión final antes de publicar
**Qué:**
- La **revisión final automática**: junta los resultados de todas las plataformas y decide "listo" o "bloqueado".
- La **versión 2.0.0 del catálogo**, la primera que permite bloquear (sólo en PR y release, y sólo con prueba objetiva) y la que trae las veintiún prácticas nuevas. Queda en espera hasta que la revisión apruebe.
- **La aprobación se invalida si alguien toca las pruebas** después de aprobar.
- Changelog y guía de migración de 1.0.0 a 2.0.0.

**Por qué importa:**
- El pack no se declara listo porque "los tests pasan en mi Mac": hace falta evidencia de todas las plataformas.
- Nadie puede debilitar las pruebas después de aprobadas sin que se note.

### Fases 17 a 20: cuatro buenas prácticas nuevas
**Qué:** cada práctica tiene:
- un formato de declaración (qué pantallas, formularios, llamadas o flags hay);
- un simulador que prueba el comportamiento real con reloj controlado y datos inventados;
- sus reglas y un ejemplo bueno junto a varios ejemplos malos;
- su suite de conformidad y su documentación.

| Práctica | Escenarios que prueba | Ejemplos malos que detecta |
|---|---|---|
| Estados de pantalla | 7 por pantalla | 7 (en blanco, sin vacío, sin timeout, sin reintento, carga doble…) |
| Formularios | hasta 6 por formulario | 9 (envía sin validar, error no ligado, doble envío, borra lo escrito…) |
| Llamadas de red | hasta 8 por operación | 8 (sin timeout, reintenta 400, reintentos infinitos, sin espera, cobra dos veces…) |
| Feature flags | 6 del cliente + 6 reglas del registro | 6 del cliente + flags vencidas, sin fecha, default inseguro… |

**Por qué importa:**
- Son los errores que más se repiten en producto y que más molestan al usuario: pantallas colgadas, formularios que pierden lo escrito, cobros duplicados y flags olvidadas.
- Al actualizar un repo existente, las cuatro nuevas quedan **apagadas**: nadie recibe avisos nuevos sin pedirlos.
- Ninguna práctica nueva toca lo que ya funcionaba: las tres primeras siguen exactamente igual.

### Fases 21 a 24: cuatro buenas prácticas más
**Qué:** con el mismo esqueleto, cada una con su declaración, su simulador, sus ejemplos buenos y malos, su suite de conformidad y su documentación.

| Práctica | Escenarios que prueba | Ejemplos malos que detecta |
|---|---|---|
| Sesión expirada | hasta 5 (renovar, 401 simultáneos, renovación fallida, 401 repetido…) | 5 (nunca renueva, renueva por pedido, bucle, error en vez de login, pierde el borrador) |
| Subida de archivos | hasta 6 por punto de subida | 8 (sin límite de tamaño o tipo, sin progreso, sin cancelar, error colgado, subida doble…) |
| Listas paginadas | hasta 6 por lista | 8 (pide de más, sin fin de lista, cargas simultáneas, borra al fallar, orden incorrecto…) |
| Analytics | 1 por evento + privacidad + envío caído | 7 (falta un dato obligatorio, tipos incorrectos, envía el email, eventos dobles, rompe la app…) |

**Por qué importa:**
- Son fallas que el usuario sufre en directo: lo sacan de la app con trabajo a medio hacer, se suben archivos que nunca debieron subirse, faltan o se repiten ítems en las listas, o se filtran datos personales a terceros.
- La de analytics usa datos personales "canario" (inventados y marcados): si aparecen en lo enviado, es una fuga comprobada, no una sospecha.
- Igual que las anteriores, al actualizar un repo existente quedan apagadas.

### Fases 25 a 27: tres buenas prácticas más

| Práctica | Escenarios que prueba | Ejemplos malos que detecta |
|---|---|---|
| Acciones destructivas | hasta 7 por acción (confirmar, cancelar, ejecutar, doble clic, deshacer, ventana vencida, error) | 7 (ejecuta al primer clic, cancelar ejecuta, doble ejecución, deshacer roto, error como éxito…) |
| Formato por idioma | 4 por idioma (fecha, número, moneda, zona horaria) + idioma de respaldo y traducción ausente | 7 (todo en inglés, fecha armada a mano, toFixed, sin moneda, fechas en UTC, muestra claves…) |
| Modo sin conexión | aviso + hasta 4 por acción (enviar, encolar, reiniciar, orden, o rechazar si es sólo online) | 9 (sin aviso, error sin red, nunca sincroniza, envía dos veces, cola en memoria, orden invertido, pago falso…) |

**Por qué importa:**
- Son errores caros e irreversibles: un borrado o un cobro que no se puede deshacer, una fecha que cae en otro día para el usuario o trabajo perdido por mala señal.
- El formato por idioma se compara con el estándar de la plataforma (`Intl`), así que no se le exige al equipo un texto exacto: sólo las convenciones del país.

### Fases 28 a 30: tres buenas prácticas más

| Práctica | Escenarios que prueba | Ejemplos malos que detecta |
|---|---|---|
| Permisos del dispositivo | 6 por permiso (al abrir, explicación, concedido, negado, no insistir, bloqueado) | 6 (pide al abrir, sin explicar, error al negar, sin alternativa, insiste, ignora el bloqueo) |
| Rutas y enlaces rotos | 4 (ruta conocida, inexistente, mal formada, enlace protegido tras el login) | 6 (pantalla en blanco, sin salida, URL que rompe, error sin sesión, olvida el destino, pierde parámetros) |
| Diálogos accesibles | hasta 6 por diálogo (foco al abrir, foco atrapado, Escape, clic afuera, rol y nombre, fondo inactivo) | 8 (foco no entra, se escapa, Escape no cierra, foco perdido, rol incorrecto, sin nombre, fondo activo…) |

**Por qué importa:**
- Un permiso mal pedido se pierde para siempre: si el usuario dice que no al abrir la app, el sistema ya no deja volver a preguntar.
- Un enlace roto en un correo o una campaña es el primer contacto del usuario con el producto.
- Los diálogos son donde más se rompe la accesibilidad, y una persona que usa teclado o lector de pantalla queda atrapada o perdida.

### Fases 31 a 36: seis buenas prácticas de backend
**Qué:** el mismo esqueleto, pero en vez de una pantalla el simulador llama al **handler HTTP o al servidor real del equipo**, dentro del mismo proceso, con base de datos y servicios externos inventados que responden, se cuelgan o fallan a pedido.

| Práctica | Escenarios que prueba | Ejemplos malos que detecta |
|---|---|---|
| Idempotencia de la API | hasta 5 por endpoint (repetido, simultáneo, claves distintas, misma clave con otro cuerpo, sin clave) | 5 (ejecuta cada vez, carrera que duplica, otra respuesta al repetir, acepta otro cuerpo, ejecuta sin clave) |
| Errores de API | 3 por endpoint (entrada inválida, JSON roto, falla interna) + ruta inexistente | 5 (no valida, JSON roto da 500, expone el stack, texto plano, ruta inexistente da 200) |
| Límite de uso | 1 por límite con 5 verificaciones | 5 (sin límite, corta antes, sin Retry-After, contador global, ventana eterna) |
| Paginación de la API | hasta 6 por listado | 8 (tamaño distinto, sin tope, límite inválido da 500, cursor que es un offset, repite ítems, sin final…) |
| Dependencias caídas | hasta 4 por dependencia (sana, colgada, con error, corte y recuperación) | 5 (sin timeout, excepción propagada, 500 genérico, sin corte, corte que no se cierra) |
| Health checks y apagado | liveness, readiness, dependencia caída, apagado con trabajo en curso, trabajo que nunca termina | 5 (liveness depende de la base, readiness la ignora, "ready" al apagar, acepta trabajo al apagar, apagado eterno) |

**Por qué importa:**
- Son las fallas que despiertan a alguien de madrugada: cobros dobles, caídas en cascada, despliegues que cortan requests.
- La de errores usa un error interno "canario" (con stack trace, IP interna y una consulta SQL inventados): si cualquiera de esos datos llega al cliente, la fuga está comprobada.
- Por diseño, la evidencia de estos controles sólo puede guardar números y verdadero/falso: nunca cuerpos, headers ni datos.

### Fase 37: logs sin datos personales
**Qué:** el simulador captura la salida del logger real del servicio mientras le manda requests con email, teléfono, tarjeta, token, cookie y contraseña "canario" en el cuerpo, los headers y la query. Revisa 4 cosas por endpoint: que cada línea sea JSON con nivel y mensaje, que todas lleven el id de la request (recibido o generado), que ningún canario aparezca y que una falla quede registrada como error sin filtrar datos. Detecta 9 ejemplos malos (texto plano, sin correlación, cuerpo o headers sin redactar, mensaje de error crudo con datos…).

**Por qué importa:** los logs se copian a muchos sistemas y los lee mucha gente; un email o un token en un log es una filtración aunque nadie "lo haya publicado".

---

## Dónde estamos hoy

| | |
|---|---|
| Fases terminadas | 1 a 15 y 17 a 37 |
| Fase 16 | construida; su revisión final da **bloqueado** |
| Prácticas | 24 (17 de interfaz y 7 de backend), todas con su suite de conformidad en verde |
| Modo actual | **sólo avisa**; ningún control puede bloquear |
| Tests del repo | 1363 en total; 1361 pasan |

### Por qué la revisión final todavía no aprueba

1. **Falta correr CI en Linux y Windows.** Hasta ahora sólo se probó en una Mac. Se resuelve con un push de la rama.
2. **Un test del pack de seguridad falla por la fecha** (el test 37.3). Usa una fecha fija que ya venció. No es de este pack, pero la revisión exige que *toda* la suite esté en verde, y hay otro test que falla por arrastre.
3. **Hay que hacer commit.** La fase 37 (logs) está sin commitear; lo anterior ya está en git (el último commit es el de las fases 1 a 4).

La revisión hace lo que tiene que hacer: no aprueba algo que no está demostrado.

### Próximos pasos

1. Commit de todo el trabajo.
2. Decidir quién arregla el test de seguridad: su dueño, o nosotros con su visto bueno (el arreglo es chico).
3. Push, para que CI corra en todas las plataformas.
4. Con todo en verde, aprobar con `node scripts/release-gate.js --approve`. A partir de ahí el catálogo 2.0.0 (con las veinticuatro prácticas) queda publicado y los equipos pueden activar el bloqueo control por control.

### Cosas menores pendientes

- Faltan comandos para validar waivers y "no aplica" por separado (hoy se validan al correr la revisión).
- La spec menciona criterios globales G1 a G7 sin definirlos en ningún lado. Los deduje del plan de tareas y conviene confirmarlos.

---

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Spec (requisitos, diseño, tareas) | `.kiro/specs/kiritek-engineering-guardrails/` |
| Código del pack | `kiritek-init/src/engineering/guardrails/` |
| Documentación para usuarios | `kiritek-init/docs/engineering/` |
| Catálogo publicado (1.0.0) | `kiritek-init/catalogs/engineering/guardrails/` |
| Catálogo en espera (2.0.0, veinticuatro prácticas) | `kiritek-init/release/candidates/` |
| Documentación de cada práctica | `kiritek-init/docs/engineering/controls/` |
| Revisión final | `kiritek-init/scripts/release-gate.js` y `kiritek-init/release/gate/` |
| CI | `.github/workflows/kiritek-init-ci.yml` |
