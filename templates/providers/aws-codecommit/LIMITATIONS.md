# Kiritek — pack AWS CodeCommit: limitaciones honestas

> Estas son **declaraciones**, no acciones. Evitan una falsa sensación de
> seguridad al adoptar el pack de AWS CodeCommit (tarea 40.5, requisitos
> 16.3 / 27.4 / G.10).

## La protección sobre la rama default NO protege las feature branches

**IAM o approval rules sobre `main`/la rama default protegen esa rama, pero no
impiden que un secreto llegue a una feature branch.** El control IAM/approval
acota quién puede empujar o fusionar en la rama default y exige revisores con
separación de funciones; **no** inspecciona el contenido ni evita que un
desarrollador haga commit/push de un secreto a una rama de feature.

Por eso, este pack **COMPLEMENTA** —nunca reemplaza— los controles del core:

- **Escaneo local** (hook `pre-commit`): detecta el secreto antes del commit.
- **Escaneo pre-push** (hook `pre-push`): bloquea el push del rango de commits.
- **Gate de CI** (Gitleaks del core en el pipeline): última red de seguridad.

Mantén los tres activos. El pipeline de CodeBuild/CodePipeline de este pack
**invoca el comando core** (`npx kiritek-init scan`) precisamente para no
reimplementar la detección y conservar esa red de seguridad en la nube.

## Otras limitaciones

- **Borrar el último commit NO revoca la credencial.** Si un secreto se expuso,
  **debe rotarse/revocarse** con el proveedor; eliminarlo del código no lo
  invalida.
- **CodeCommit no excluye nativamente al autor del conteo de aprobaciones.** La
  separación de funciones y la prevención de autoaprobación se refuerzan con un
  pool de aprobadores por rol IAM distinto del autor, más la política IAM de
  mínimo privilegio. Revísalo según las capacidades vigentes de tu cuenta.
- **Las credenciales de larga duración deben rotarse/revocarse.** Prefiere
  roles y credenciales temporales (STS). La detección de claves obsoletas se
  reporta de forma **redactada**: nunca se imprime el valor de la clave.
- **Este plan es dry-run.** No muta estado cloud ni abre red. Cualquier
  aplicación requiere **confirmación humana explícita** mediante un mecanismo
  fuera de este plan.
