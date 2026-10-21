# Manual de uso: seguridad y buenas prácticas

Guía práctica para los equipos que usan `kiritek-init`. Explica cómo instalar
cada pack, qué hacer cuando algo avisa o bloquea, y cómo adoptar las buenas
prácticas en un repo. Para saber qué es cada cosa y por qué existe, ver
[RESUMEN-SEGURIDAD-Y-BUENAS-PRACTICAS.md](RESUMEN-SEGURIDAD-Y-BUENAS-PRACTICAS.md).

> **Cómo se escriben los comandos.** En este manual, `kiritek-init` es la
> forma corta de:
>
> ```bash
> npx github:Kiritek-Pods/Framework-Kiritek#npx-release
> ```
>
> Por ejemplo, `kiritek-init security audit` se corre como
> `npx github:Kiritek-Pods/Framework-Kiritek#npx-release security audit`.
> Todos los comandos se corren **dentro del repo del proyecto**.

---

## Índice

1. [Instalar](#1-instalar)
2. [Seguridad en el día a día](#2-seguridad-en-el-día-a-día)
3. [Cuando la seguridad avisa o bloquea](#3-cuando-la-seguridad-avisa-o-bloquea)
4. [Pasar la seguridad a modo bloqueo](#4-pasar-la-seguridad-a-modo-bloqueo)
5. [Buenas prácticas: primeros pasos](#5-buenas-prácticas-primeros-pasos)
6. [Adoptar una práctica (ejemplo completo)](#6-adoptar-una-práctica-ejemplo-completo)
7. [Revisar y entender los resultados](#7-revisar-y-entender-los-resultados)
8. [Excepciones: deuda temporal y "no aplica"](#8-excepciones-deuda-temporal-y-no-aplica)
9. [Pasar una práctica a modo bloqueo](#9-pasar-una-práctica-a-modo-bloqueo)
10. [Actualizar y desinstalar](#10-actualizar-y-desinstalar)
11. [Preguntas frecuentes](#11-preguntas-frecuentes)

---

## 1. Instalar

### Seguridad

Viene incluida. Al correr `init`, el pack de seguridad se instala siempre,
sin importar el stack:

```bash
kiritek-init init
```

Queda en modo **aviso**: corre en cada commit y en cada push, informa lo que
encuentra y sólo bloquea dos peligros graves que vienen definidos de fábrica:
el push directo a la rama principal y el push forzado. Si el repo
ya tenía hooks de Git propios, se respetan y se encadenan.

Para comprobar que quedó bien:

```bash
kiritek-init security audit
```

### Buenas prácticas

Se instalan aparte, cuando el equipo las quiere:

```bash
kiritek-init guardrails install --dry-run          # muestra qué va a crear, sin tocar nada
kiritek-init guardrails install --surfaces=git,ci  # instala hook de pre-commit y workflow de CI
```

Si el equipo usa Kiro o Claude Code, agregue `kiro` y/o `claude` a
`--surfaces`. Por ejemplo: `--surfaces=git,ci,claude`.

La instalación crea `kiritek-engineering.config.json` en la raíz del repo.
Todas las prácticas quedan en modo **aviso** (`warn`).

> **Las 32 prácticas nuevas** (todas salvo buscador, versión mínima de la app
> y anuncio de módulos) llegan con el catálogo 2.0.0. Cuando se publique, se
> activan con `kiritek-init guardrails update --to=2.0.0`. Ver la
> [sección 10](#10-actualizar-y-desinstalar).

---

## 2. Seguridad en el día a día

No hay que hacer nada especial: los controles corren solos.

| Cuándo | Qué revisa |
|---|---|
| Al hacer `git commit` | Que no haya secretos ni archivos sensibles en lo que está en stage, y que el mensaje siga Conventional Commits (`feat: …`, `fix: …`) |
| Al hacer `git push` | Que los commits que se van a enviar no tengan secretos; que no sea un push directo a la rama principal ni un push forzado peligroso; si Jira está activo, que los tickets citados existan |
| En CI | Todo el repo y su historial |
| Cuando Claude Code o Kiro quieren escribir un archivo o correr un comando | Que no escriban secretos ni salten los controles |

Reglas que conviene recordar:

- **Nunca uses `--no-verify`.** Los asistentes lo tienen prohibido y, además,
  CI vuelve a revisar todo.
- **Los secretos van en variables de entorno o en el gestor de secretos**,
  nunca en el código. Para documentar qué variables hacen falta, usa un
  `.env.example` con valores de ejemplo (`YOUR_API_KEY`, `<REPLACE_ME>`).
- **Ramas de feature**: trabaja en `feature/TICKET-123-descripcion` y entra a
  la rama principal por PR.

Para revisar a mano en cualquier momento:

```bash
kiritek-init scan --scope=staged       # lo que está en stage
kiritek-init scan --scope=push         # lo que enviaría un push
kiritek-init scan --scope=repository   # todo el repo
kiritek-init validate commit --message="feat: agrega login"
```

---

## 3. Cuando la seguridad avisa o bloquea

### "Se detectó un secreto"

**Si todavía no hiciste push** (el secreto se atrapó antes de salir de tu
máquina):

1. Saca el valor del código y muévelo a una variable de entorno.
2. Si el valor pudo verse en otro lado (un chat, un ticket, una captura),
   **rótalo** igual.
3. Vuelve a hacer el commit.

**Si ya llegó al remoto**, el orden importa:

1. **Rota o revoca la credencial con el proveedor**: AWS, la base de datos,
   el servicio que sea. Es lo único que invalida el secreto; borrar el commit
   no alcanza.
2. Revisa en los logs del proveedor si alguien la usó.
3. Sácala del código.
4. Recién ahí, si hace falta, se decide limpiar el historial, coordinado con el
   equipo.
5. Avisa a seguridad **sin pegar el valor**. Comparte el reporte, que ya viene
   sin el secreto.

Guía completa: `templates/core/security/docs/INCIDENT-RESPONSE.md`.

### "Es un falso positivo"

Puede ser un valor de ejemplo que el detector confunde con un secreto real.
No uses `--no-verify` ni desactives el escaneo. Abre una **excepción
gobernada**: un archivo con dueño, motivo y fecha de vencimiento, que se
revisa por PR. Para validarla:

```bash
kiritek-init security exception validate --file=<ruta-del-archivo>
```

### "El mensaje de commit no es válido"

El formato es `tipo: descripción`, con tipos como `feat`, `fix`, `docs`,
`refactor`, `test` o `chore`, y un asunto de 72 caracteres como máximo. Si
Jira está activo, incluye la clave del ticket (por ejemplo `PROJ-123`).

### "Push directo a la rama principal"

Crea una rama, súbela y abre un PR. La rama principal se detecta sola, así
que no importa si se llama `main`, `master` u otra cosa.

### "Jira no responde"

Si Jira está caído, el control marca el ticket como **no verificado**. No
inventa un "ok". Según la configuración del equipo, el push se frena
(`fail-closed`) o sigue con aviso (`warn`).

---

## 4. Pasar la seguridad a modo bloqueo

Cuando el equipo ya no tiene avisos pendientes:

```bash
kiritek-init security doctor                # ¿está listo para bloquear?
kiritek-init security promote --to=enforce  # pasa a bloqueo si el chequeo lo permite
```

`doctor` dice qué falta (por ejemplo, un hook desconectado o evidencia
vieja). Si no está listo, `promote` no hace nada.

Recuerda que los hooks locales se pueden saltar. La protección definitiva es
la de CI y la del proveedor. Para GitHub o AWS CodeCommit se puede generar un
plan de protección de ramas, para revisarlo y aplicarlo a mano:

```bash
kiritek-init provider plan github
kiritek-init provider plan aws-codecommit
```

El plan **nunca** se aplica solo.

---

## 5. Buenas prácticas: primeros pasos

### Declarar qué es cada parte del repo

Edita `kiritek-engineering.config.json`. Cada parte del repo (una app, un
servicio, un paquete) es una **unidad**, y declara sus **perfiles**: qué tipo
de pieza es. Una práctica sólo se revisa en las unidades que declaran el
perfil que la práctica necesita.

```json
{
  "schemaVersion": 1,
  "pack": { "id": "engineering/guardrails", "catalog": "2.0.0" },
  "workspace": {
    "units": [
      {
        "id": "acme/api",
        "root": "services/api",
        "kind": "application",
        "profiles": [
          { "id": "http-api", "version": "1.0.0" },
          { "id": "backend-service", "version": "1.0.0" }
        ],
        "owns": ["services/api/**"]
      }
    ]
  }
}
```

### Qué perfil activa cada práctica

| Perfil | Declararlo si la unidad… | Prácticas que activa |
|---|---|---|
| `web` | es una web | Anuncio de módulos nuevos |
| `mobile-app` | es una app móvil | Versión mínima de la app |
| `search` | tiene un buscador | Buscador responsable |
| `data-views` | muestra datos que carga | Estados de pantalla |
| `forms` | tiene formularios | Formularios accesibles |
| `network-client` | llama a APIs | Llamadas de red resilientes |
| `feature-flags` | usa feature flags | Feature flags con vencimiento |
| `auth-session` | tiene sesión de usuario | Sesión expirada |
| `file-upload` | sube archivos | Subida de archivos |
| `paginated-lists` | muestra listas largas | Listas paginadas |
| `analytics` | envía eventos de analytics | Eventos de analytics |
| `destructive-actions` | tiene acciones de borrar, cancelar o pagar | Acciones destructivas |
| `localized` | se usa en varios idiomas o países | Formato por idioma |
| `offline-capable` | debe funcionar sin red | Modo sin conexión |
| `device-permissions` | pide cámara, ubicación, etc. | Permisos del dispositivo |
| `routed-app` | tiene rutas o enlaces profundos | Rutas y enlaces rotos |
| `dialogs` | usa modales o menús | Diálogos accesibles |
| `http-api` | expone una API HTTP | Idempotencia, errores, límite de uso, paginación, edición concurrente, versionado, límites de tamaño y tiempo, caché HTTP, respuestas según su schema, operaciones largas, operaciones en lote |
| `backend-service` | es un servicio de backend | Dependencias caídas, health checks y apagado, logs, migraciones, borrado de datos del usuario, métricas, configuración al arrancar |

No hace falta adoptar todo de una vez. Una práctica sin contrato sólo deja un
aviso amable ("declare el contrato para verificar esto"), nunca bloquea.

---

## 6. Adoptar una práctica (ejemplo completo)

Ejemplo con **Idempotencia de la API**: verificar que un reintento no cree
dos órdenes. El mismo patrón sirve para las 35 prácticas. El contrato y el
adaptador de cada una están en `docs/engineering/controls/<práctica>.md`.

### Paso 1 — Escribir el contrato

Un JSON corto que dice qué promete el código. Por ejemplo,
`services/api/idempotency.contract.json`:

```json
{
  "schemaVersion": 1,
  "control": "api.idempotency",
  "endpoints": [
    { "id": "create-order", "method": "POST", "path": "/orders", "keyHeader": "Idempotency-Key", "requireKey": true, "sampleBody": { "sku": "k-sku-1", "qty": 1 } }
  ],
  "harness": { "kind": "node-adapter", "adapter": "services/api/test/idempotency.adapter.js" }
}
```

### Paso 2 — Escribir el adaptador

Un archivo chico que conecta el código real con el simulador. El simulador
le da un reloj falso y dependencias falsas: así puede cortar la red,
reintentar o apagar el servicio sin tocar nada real. Por ejemplo,
`services/api/test/idempotency.adapter.js`:

```js
exports.createApiUnderTest = ({ clock, deps }) => {
  // Conecte aquí el handler real de la API, reemplazando el efecto real
  // (insertar la orden, cobrar) por deps.effect().
  return {
    async handle({ method, path, query, headers, body }) {
      // → { status, headers, body }
    },
  };
};
```

### Paso 3 — Apuntar la práctica al contrato

En la unidad, dentro de `kiritek-engineering.config.json`:

```json
"controls": {
  "api.idempotency": { "level": "warn", "parameters": { "idempotencyContract": "services/api/idempotency.contract.json" } }
}
```

### Paso 4 — Correrla

```bash
kiritek-init guardrails validate     # revisa que la configuración sea válida
kiritek-init guardrails scan --moment=pr --base=<sha-base> --revision=<sha-actual>
```

Las pruebas de comportamiento corren en el PR y en el release. En el editor y
en el pre-commit sólo se revisan los contratos, para no hacer esperar a
nadie.

---

## 7. Revisar y entender los resultados

```bash
kiritek-init guardrails audit
```

Muestra, por unidad y por práctica, si está verificada, si tiene evidencia
vieja o si falta algo. Cada aviso trae **qué regla falló y cómo arreglarlo**.
El catálogo completo de arreglos está en `docs/engineering/remediation.md`.

| Lo que ves | Qué significa | Qué hacer |
|---|---|---|
| `allow` | La práctica se cumple | Nada |
| `warn` con una regla | El código no cumple algo concreto | Arreglarlo según la remediación |
| `warn` "declare el contrato" | Se sospecha que la práctica aplica, pero no hay contrato | Escribir el contrato o declarar "no aplica" |
| `unavailable` o `timeout` | El simulador no pudo correr (adaptador mal ubicado, tiempo agotado) | Revisar la ruta del adaptador; **no es un incumplimiento** |
| `conflict` (`FLAKY_SCENARIO`) | El mismo escenario dio resultados distintos en dos corridas | Usar el reloj y las dependencias del simulador, no los reales |
| `stale` | La evidencia es de otro commit | Volver a correr el scan |
| `deny` | Falla objetiva **y** el equipo activó el bloqueo para esa práctica | Arreglar, o volver a `warn` si es un error del control |

Si un aviso no corresponde a un problema real, regístralo. Eso alimenta la
medición de falsos positivos:

```bash
kiritek-init guardrails feedback --control=<práctica> --rule=<regla> --fingerprint=<id> --verdict=false-positive
```

---

## 8. Excepciones: deuda temporal y "no aplica"

A veces hay que convivir con un problema conocido por un tiempo, o una
práctica no aplica a una unidad. Para eso hay dos tipos de excepción, siempre
**acotadas y con vencimiento**:

| Tipo | Para qué | Dónde va |
|---|---|---|
| **Waiver** (deuda temporal) | Aceptar un problema concreto mientras se arregla | `.kiritek/engineering/waivers/*.json` |
| **N/A** (no aplica) | Declarar que una práctica no aplica a una unidad, con la prueba de por qué | `.kiritek/engineering/not-applicable/*.json` |

Un waiver debe decir a qué práctica, unidad y falla exacta aplica, quién es
el dueño, quién lo aprobó (no puede ser la misma persona), el motivo, el
ticket y cuándo vence (como máximo 90 días). Se revisa por PR, como cualquier
cambio. Formato exacto: `schemas/engineering/waiver.schema.json`.

Lo que **no** se acepta: excepciones para todo el repo, auto-aprobadas o sin
vencimiento. Al vencer, la práctica vuelve a revisarse sola.

---

## 9. Pasar una práctica a modo bloqueo

El bloqueo se activa **práctica por práctica y unidad por unidad**, nunca en
bloque:

```bash
kiritek-init guardrails doctor --unit=acme/api --control=api.idempotency
kiritek-init guardrails promote --unit=acme/api --control=api.idempotency --to=enforce --dry-run
kiritek-init guardrails promote --unit=acme/api --control=api.idempotency --to=enforce
```

`doctor` dice qué falta: evidencia verificada en PR y release, CI instalado,
sin excepciones inválidas y menos de 5 % de falsos positivos. El paso queda
registrado en `.kiritek/engineering/promotions.jsonl`, para revisarlo en el
PR.

Aun en modo bloqueo, **sólo bloquea una falla objetiva**. Las sospechas y las
fallas técnicas del simulador nunca bloquean.

Para volver atrás (siempre permitido):

```bash
kiritek-init guardrails promote --unit=acme/api --control=api.idempotency --to=warn
```

---

## 10. Actualizar y desinstalar

### Seguridad

```bash
kiritek-init update               # trae las mejoras sin pisar lo personalizado
kiritek-init uninstall --security # saca sólo lo que instaló Kiritek
```

### Buenas prácticas

```bash
kiritek-init guardrails catalog diff --to=2.0.0   # qué cambia antes de actualizar
kiritek-init guardrails update --to=2.0.0 --dry-run
kiritek-init guardrails update --to=2.0.0
kiritek-init guardrails uninstall
```

- `update` guarda un respaldo y, si algo falla, vuelve atrás solo. Las
  prácticas nuevas llegan apagadas (`off`), y los niveles que ya tenías se
  conservan.
- `uninstall` saca sólo lo de buenas prácticas y restaura el hook de Git
  anterior. **No toca nada de seguridad**, ni las excepciones ni la evidencia.
  Para borrar también la evidencia: `--purge-evidence`.

---

## 11. Preguntas frecuentes

**¿Esto me va a romper el repo el primer día?**
No. Los dos packs arrancan en modo aviso. Lo único que se bloquea de
entrada son dos peligros graves de Git: el push directo a la rama principal
y el push forzado.

**¿Tengo que usar alguna librería en particular?**
No. Las buenas prácticas revisan cómo se comporta el código, sin importar
con qué está hecho. Seguridad tampoco exige proveedor: GitHub y AWS son
opcionales.

**¿Kiritek bloquea código escrito con IA?**
No, nunca. Sólo revisa hechos: secretos, archivos, formato, ramas y
comportamiento.

**¿Qué pasa con los datos de mis usuarios?**
Ningún pack guarda código, datos de usuarios, secretos ni prompts. La
evidencia de buenas prácticas sólo guarda números y verdadero/falso.

**Un control falló porque no pudo correr. ¿Incumplí algo?**
No. Una falla técnica (herramienta ausente, simulador que no arrancó, tiempo
agotado) se informa como tal y nunca bloquea.

**¿Funciona sin internet?**
Sí. Con `--offline`, las buenas prácticas usan sólo lo verificado
localmente. Lo que necesitaría red queda como "no disponible", nunca como
incumplimiento.

**¿Dónde busco más detalle?**

| Tema | Dónde |
|---|---|
| Seguridad: guía completa | `templates/core/security/docs/SECURITY.md` |
| Seguridad: incidentes y rotación | `templates/core/security/docs/INCIDENT-RESPONSE.md` |
| Seguridad: migración desde versiones anteriores | `templates/core/security/docs/MIGRATION.md` |
| Buenas prácticas: guías por escenario (repo nuevo, existente, monorepo, CI) | `docs/engineering/guides.md` |
| Buenas prácticas: configuración completa | `docs/engineering/configuration.md` |
| Buenas prácticas: cada práctica, con su contrato y adaptador | `docs/engineering/controls/` |
| Buenas prácticas: cómo arreglar cada aviso | `docs/engineering/remediation.md` |
| Buenas prácticas: qué hacer ante cada problema | `docs/engineering/runbooks.md` |
