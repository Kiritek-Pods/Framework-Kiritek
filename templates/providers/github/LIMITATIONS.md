# Kiritek — pack GitHub: limitaciones honestas

> Estas son **declaraciones**, no acciones. Evitan una falsa sensación de
> seguridad al adoptar el pack de GitHub (requisitos 16.3 / 27.4 / G.10).

## La protección sobre la rama default NO protege las feature branches

**Un ruleset o branch protection sobre `main`/la rama default protege esa rama,
pero no impide que un secreto llegue a una feature branch.** La branch
protection acota quién puede empujar o fusionar en la rama default y exige
revisión de Code Owners; **no** inspecciona el contenido ni evita que un
desarrollador haga commit/push de un secreto a una rama de feature.

Por eso, este pack **COMPLEMENTA** —nunca reemplaza— los controles del core:

- **Escaneo local** (hook `pre-commit`): detecta el secreto antes del commit.
- **Escaneo pre-push** (hook `pre-push`): bloquea el push del rango de commits.
- **Gate de CI** (Gitleaks del core en el workflow): última red de seguridad.

Mantén los tres activos. El workflow de este pack **invoca el comando core**
(`npx kiritek-init scan`) precisamente para no reimplementar la detección y
conservar esa red de seguridad en la nube.

## Capacidades dependientes de plan y permisos

- **Los rulesets y ciertas protecciones dependen del plan y de los permisos de
  la organización.** Repos privados en planes sin rulesets, o cuentas sin
  permiso de administración, no pueden aplicar todas las protecciones descritas.
  El plan marca esas capacidades como dependientes de plan/permisos y declara el
  fallback; Kiritek **no** finge que una protección quedó activa si la cuenta no
  la soporta.
- **CODEOWNERS por sí solo no obliga revisión.** Debe acompañarse de un ruleset o
  branch protection que exija "require review from Code Owners" sobre la rama
  default. El plan del pack describe ese ruleset/branch protection.

## Otras limitaciones

- **Borrar el último commit NO revoca la credencial.** Si un secreto se expuso,
  **debe rotarse/revocarse** con el proveedor; eliminarlo del código no lo
  invalida.
- **Los hooks de cliente son evadibles.** El enforcement definitivo depende de
  los controles remotos (este workflow y los rulesets).
- **Este plan es dry-run.** No muta estado remoto ni abre red. Cualquier
  aplicación requiere **confirmación humana explícita** mediante un mecanismo
  fuera de este plan.
