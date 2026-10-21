# Canal de release, integridad y procedencia

Este documento describe cómo se distribuye `kiritek-init`, cómo verificar la
integridad de lo que instalas y cómo se construye de forma reproducible y
trazable. Es parte del hub [`SECURITY.md`](./SECURITY.md).

> **Principio.** El canal es **inmutable y verificable**. No se recomienda, en
> ningún punto, instalar ejecutando un script remoto sin verificación previa, ni
> fijar dependencias a etiquetas mutables.

## 1. Canal oficial

`kiritek-init` se distribuye desde el repositorio oficial de Kiritek. La
instalación se hace **siempre contra una referencia fija** —una versión
publicada o un commit SHA inmutable— nunca contra una rama móvil que pueda
cambiar bajo tus pies.

- Referencia recomendada: una **versión publicada** (tag de versión) o un
  **commit SHA de 40 hex**.
- El acceso usa el mismo mecanismo (SSH/`gh`) que ya empleas para clonar el repo.
- La integración con Spec Kit usa la herramienta oficial de GitHub vía su runner
  (`uvx`), sin fork ni versión propia.

## 2. Integridad del tarball

El paquete se publica como un tarball (`kiritek-init-<version>.tgz`). Antes de
confiar en un tarball:

1. Obtén el **SHA-256** publicado para esa versión en las notas de release.
2. Calcula el SHA-256 local del archivo descargado.
3. Compara ambos valores; deben ser **idénticos**. Si difieren, **no** instales:
   el artefacto no es el publicado.

```bash
# Verificación de integridad (ejemplo de comando, no de valor):
shasum -a 256 kiritek-init-<version>.tgz
# Compara el resultado con el SHA-256 de las notas de release.
```

La verificación de integridad de las **herramientas** que Kiritek ejecuta
(p. ej. Gitleaks) es independiente y automática: el manifiesto
(`templates/core/security/tools/manifest.json`) fija versión exacta, plataforma,
arquitectura, URL HTTPS allowlisted y SHA-256 por artefacto. La cache verifica el
checksum **antes** de ejecutar el binario y rechaza cualquier artefacto que no
coincida; nunca se descarga ni ejecuta un binario sin checksum verificado.

## 3. Versionado y procedencia reproducible

- **Versionado semántico.** Las versiones siguen `MAJOR.MINOR.PATCH`. Un cambio
  que endurece un control hasta `deny` por defecto es un cambio con impacto de
  enforcement y se documenta como tal en el [`CHANGELOG.md`](./CHANGELOG.md).
- **Referencias inmutables.** Las dependencias de CI (GitHub Actions) se fijan
  por **commit SHA de 40 hex**, nunca por etiqueta mutable. Las herramientas se
  fijan por versión exacta + checksum.
- **Procedencia.** Cuando el artefacto lo permite, se registra procedencia e
  inventario/SBOM de los componentes inspeccionados. La actualización de pins y
  checksums se documenta con notas de release y un procedimiento de rollback.
- **Reproducibilidad.** Los planes de provider y la evidencia son deterministas:
  con el mismo input (config + reloj/ids inyectables) producen una salida
  byte-idéntica, de modo que un plan puede revisarse y re-generarse sin sorpresas.

## 4. Actualización de pins y rollback

- Toda subida de versión de una herramienta fijada actualiza versión **y**
  checksums en el manifiesto, acompañada de release notes.
- Si una versión nueva introduce un problema, el rollback consiste en volver a la
  referencia inmutable anterior (versión/SHA) documentada en el changelog; la
  cache direccionada por versión/checksum permite reinstalar el artefacto previo
  verificado.

## 5. Lo que NO hacemos

- No fijamos dependencias ni actions a etiquetas mutables.
- No recomendamos instalar ejecutando un script remoto sin verificación.
- No publicamos un artefacto sin su SHA-256 verificable.
- No declaramos una versión como `verified` sin evidencia del mismo commit.
