# Respuesta a incidentes y rotación de secretos

Este runbook guía la respuesta cuando `kiritek-init` detecta o expone un secreto.
Está pensado para ser accionable y honesto sobre sus límites. No pegues nunca el
valor del secreto en tickets, logs, PRs ni en este repositorio: enlaza siempre el
reporte redactado.

> **Nota de seguridad.** Todo ejemplo de credencial en este documento es un
> **placeholder sintético** (p. ej. `AKIAEXAMPLE…`, truncado). No corresponde a
> ninguna credencial real.

## 1. Clasificar el incidente

El sistema diferencia dos clases (`src/incident/classify.js`):

- **`local-blocked`** — el secreto fue atrapado **antes de publicar** (staged,
  pre-commit o pre-push bloqueado). **No llegó al remoto.** La prioridad es
  sacarlo del código; la rotación es condicional.
- **`published`** — el secreto **llegó al remoto o al historial** (push
  efectuado, rama remota, tag, commit anterior, o detectado en CI). **La
  revocación/rotación es obligatoria.**

La severidad considera proveedor, privilegios, exposición y entorno. Una
credencial de alto privilegio o de producción escala a crítica.

## 2. Pasos de respuesta (orden canónico)

1. **Contener** — restringe el uso de la credencial y evita nuevos commits/push
   con el valor.
2. **Revocar / rotar** — revoca en el proveedor y emite reemplazo. **Esta es la
   única acción que invalida el secreto.**
3. **Evaluar uso** — revisa logs del proveedor para estimar uso indebido
   mientras estuvo expuesto. Si la fuente no lo permite observar, declóralo como
   **desconocido** (no inventes un veredicto).
4. **Eliminar del código** — quita la referencia, despliega y mueve el valor a un
   secret store/variable de entorno.
5. **Decidir tratamiento del historial** — opcional, coordinado y **nunca**
   sustituye la rotación. Usa el checklist gated (sección 4).
6. **Notificar** — avisa a seguridad/propietarios **sin incluir el valor**;
   enlaza el reporte redactado.
7. **Cerrar** — conserva evidencia redactada de rotación, alcance y controles
   preventivos; registra aprendizajes.

## 3. Limitaciones honestas (léelas antes de reaccionar)

Estas son **declaraciones**, no acciones. Evitan una falsa sensación de
seguridad:

- **Borrar el último commit NO revoca la credencial.** Reescribir el historial
  tampoco. Si el secreto se expuso, **debe rotarse/revocarse** con el proveedor;
  eliminarlo del código no lo invalida (19.2).
- **La protección sobre la rama default NO protege las feature branches.** IAM o
  rulesets sobre `main`/default protegen esa rama, pero **no impiden que un
  secreto llegue a una feature branch**. El procedimiento se activa igual, y los
  escaneos local, pre-push y CI siguen siendo obligatorios (19.3, 16.3, 27.4,
  G.10).
- **Los hooks de cliente no detienen todos los bypasses.** El enforcement final
  depende de controles remotos.

## 4. Reescritura de historial — checklist GATED

La reescritura **no es automática**. Cada ítem requiere confirmación humana
(`src/incident/runbook.js` → `historyRewriteChecklist`). Orden recomendado:

- [ ] **Invalidación previa** — la credencial ya fue revocada/rotada **antes** de
      tocar el historial. Reescribir sin revocar no protege nada.
- [ ] **Coordinación** — el equipo está avisado: cambiarán los SHAs y se romperán
      los clones existentes.
- [ ] **Backup** — existe un espejo del repositorio y de las refs por si hay que
      revertir.
- [ ] **Enumerar clones, refs y tags afectados** — se identificaron clones,
      forks, ramas, tags y quién debe re-clonar.
- [ ] **Ejecutar reescritura coordinada** — ejecutada manualmente por una persona
      autorizada (p. ej. `git filter-repo`), fuera de este sistema.
- [ ] **Verificación posterior** — el valor ya no aparece en ninguna ref/tag/clon
      alcanzable y la credencial anterior está inválida.

## 5. Evidencia de cierre (redactada)

Al cerrar, conserva evidencia **redactada** de rotación, alcance y controles
(`recordRotationEvidence`). Nunca almacenes el secreto original (19.5, G.12). La
evidencia registra, entre otros: `incidentId`, `controlId`, `scope`, `rotated`,
`rotatedAt` (o `null` si la fuente no permite observarlo), `rotationObservable`,
`preventiveControls` y `fingerprint` del hallazgo.

## 6. Umbrales de rotación

Para credenciales administradas con fecha de rotación observable, la auditoría
**advierte** y luego **falla** según umbrales configurables
(`assessRotationAge`, por defecto warn ≥ 80 días, fail ≥ 90 días). Si la fuente
remota **no permite observar** la fecha de rotación, el estado es `unknown` y no
se advierte ni se falla por edad (honesto, 19.6).

## 7. Runbooks relacionados (resumen)

- **Falso positivo** — abre una excepción gobernada (owner, razón, expiración);
  nunca uses `--no-verify` ni allowlists globales.
- **Herramienta no disponible** — el control reporta `tool_unavailable`/`error`,
  nunca `clean`; corrige la integridad antes de promover.
- **Jira caído** — en fallback se marca `unverified`, jamás `verified`.
- **Secreto detectado (local)** — clase `local-blocked`: elimina del código;
  rota si el valor pudo quedar comprometido.
- **Secreto publicado** — clase `published`: **revoca/rota primero**, luego
  evalúa uso, elimina y decide historial.
- **Rotación** — registra evidencia redactada; respeta los umbrales de edad.
- **Reescritura de historial** — sólo con el checklist gated completo.
- **Break-glass** — flujo separado con identidad autorizada, motivo,
  ticket/incidente, alcance, expiración y revisión posterior; nunca `--no-verify`.
