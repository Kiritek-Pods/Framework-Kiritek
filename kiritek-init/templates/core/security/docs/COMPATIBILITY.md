# Compatibilidad de plataforma — Kiritek

Este documento declara el subconjunto de plataformas, arquitecturas y
capacidades que Kiritek soporta, y la política de pruebas asociada
(requisitos 23.1–23.7, 26.2, 26.7, G.14).

## Matriz declarada

| Plataforma | Arquitecturas | Runtime de hooks        | Estado        |
|------------|---------------|-------------------------|---------------|
| macOS      | x64, arm64    | shell POSIX + Node      | soportado     |
| Linux      | x64, arm64    | shell POSIX + Node      | soportado     |
| Windows    | x64, arm64    | Node + PowerShell / Git-for-Windows shell | soportado (subconjunto) |

Arquitecturas fuera de `x64`/`arm64` no tienen binarios de herramientas
fijados: el preflight lo marca como **incompatibilidad dura** y Kiritek
**no simula** que el escaneo ocurrió.

## Capacidades POSIX

Algunas capacidades dependen de un sistema POSIX. En Windows nativo se
**declaran no disponibles con una razón** en lugar de asumirlas:

| Capacidad    | POSIX | Windows nativo | Alternativa soportada                         |
|--------------|-------|----------------|-----------------------------------------------|
| `symlink`    | sí    | no (sin privilegio/Developer Mode) | archivos regulares             |
| `exec-bit`   | sí    | no             | shim Node/PowerShell en vez del bit ejecutable |
| `file-mode`  | sí    | no             | se evita `chmod`; se declara la alternativa    |

## Symlinks: política follow / no-follow

Para **contención** (¿esta ruta pertenece al repo?) Kiritek resuelve el
`realpath` del destino —es decir, **sigue** el symlink únicamente para
validar hacia dónde apunta— y exige que el destino real quede **dentro de la
raíz real del repositorio**. Un symlink cuyo destino cae fuera del repo se
trata como **escape** y se **rechaza**. Kiritek nunca opera fuera del árbol
real del repositorio siguiendo un enlace.

## Worktrees y monorepos

- La raíz del worktree se resuelve con `git rev-parse` (sin shell), nunca
  asumiendo el directorio actual.
- Un **worktree enlazado** tiene un `.git` que es un **archivo** con un puntero
  `gitdir:` (no un directorio); Kiritek lo detecta y resuelve el git dir real.
- En monorepos/subdirectorios se resuelve la raíz del workspace sin escanear
  fuera del repositorio.

## Preflight (read-only)

Antes de cualquier mutación, Kiritek ejecuta un preflight de sólo lectura que
valida Node, Git, shell/runtime, permisos de escritura, arquitectura,
conectividad/proxy/CA y compatibilidad de plataforma. Una incompatibilidad
dura **bloquea** la mutación; los problemas blandos **advierten** y permiten
continuar.

## Red / proxy / CA

Sin red o con proxy corporativo, Kiritek usa cache/fuentes configuradas,
respeta certificados corporativos explícitos (`NODE_EXTRA_CA_CERTS`) y ofrece
instalación manual verificada. El preflight no asume conectividad: en ausencia
de una sonda, reporta estado "desconocido" en vez de inventar red.

## Política de pruebas y skips

La matriz CI ejecuta pruebas unitarias, de integración y smoke en las
plataformas declaradas. Las aserciones específicas de POSIX (symlinks, modos
de archivo, bit ejecutable) se **saltan en Windows registrando la razón**;
un test nunca se omite en silencio. Ver `ci/github/kiritek-compat-matrix.yml`.
