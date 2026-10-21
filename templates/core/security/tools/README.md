# Herramientas y política de supply chain

Este directorio fija las herramientas externas que el core de seguridad ejecuta
(hoy: Gitleaks). El objetivo es que una instalación de seguridad **no** introduzca
dependencias no verificadas.

## Reglas

- **Versión exacta.** `manifest.json` fija una versión semántica exacta por
  herramienta. Nada de `latest`, rangos (`^`, `~`, `*`) ni tags mutables.
- **Checksum obligatorio.** Cada artefacto declara su SHA-256. La cache
  (`src/scanners/tool-cache.js`) verifica el checksum antes de ejecutar y no
  reutiliza un binario que no coincida.
- **Hosts permitidos.** Las descargas sólo se aceptan por HTTPS desde los hosts
  de la allowlist (`ALLOWED_HOSTS` en `src/scanners/tool-manifest.js`).
- **Sin `curl | sh`.** No se ejecutan instaladores remotos por pipe. El binario
  se descarga a un archivo temporal, se verifica y se promueve atómicamente.
- **Offline-aware.** Sin red y sin cache válida, la herramienta se reporta como
  `unavailable`; nunca se simula que el escaneo ocurrió.

## Completar los pins (checksums reales)

Los `sha256` del manifiesto que empiezan con `REPLACE_WITH_VERIFIED_...` son
**placeholders**: la cache los trata como no verificados y rechaza ejecutar la
herramienta hasta reemplazarlos por el hash real publicado por el proyecto.

Procedimiento para fijar una versión:

1. Tomar los checksums oficiales del release de la herramienta (fichero de
   checksums firmado del proyecto, no un mirror arbitrario).
2. Verificar que corresponden a la versión y plataforma declaradas.
3. Reemplazar cada `sha256` en `manifest.json`.
4. Registrar en el changelog la versión, fecha y motivo del cambio, indicando si
   altera el comportamiento de enforcement.

## Actualizar una versión (bump)

1. Cambiar `version` y las `url` del artefacto.
2. Repetir el procedimiento de checksums.
3. Mantener el changelog y, si procede, un período en modo warning antes de
   enforcement.

## Rollback

Como la cache se direcciona por versión + checksum, revertir el manifiesto a la
versión anterior reutiliza (o re-descarga y verifica) el binario previo sin
colisiones. No se requiere limpiar la cache manualmente.
