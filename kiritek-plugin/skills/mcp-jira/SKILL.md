---
name: mcp-jira
description: >
  Use when a ticket/historia de Jira necesita traerse al chat, o cuando hay que
  actualizar un ticket (comentario, endpoint, transición de estado) al cerrar
  trabajo. Requiere el servidor MCP oficial de Atlassian conectado.
---

# MCP Jira

Conecta Claude Code directo a Jira vía el **servidor MCP oficial de Atlassian**
(Rovo) — no un servidor de comunidad. Elimina el paso manual de copiar/pegar
tickets al chat.

## Setup (una vez por developer)

```bash
claude mcp add --transport http jira https://mcp.atlassian.com/v1/mcp/authv2
```

Primer uso dispara login OAuth 2.1 por browser (recomendado). Para automatización
sin usuario interactivo (ej. la rutina programada que revisa tickets simples, ver
§5 de la propuesta Framework Kiritek), usar API token: un admin de Kiritek debe
habilitarlo primero en Atlassian Administration → Rovo → Rovo MCP server →
Authentication.

## Qué expone

- **Read**: traer issues, buscar vía JQL
- **Write**: crear/actualizar issues, comentarios
- **Search**: filtrar/descubrir contenido de Jira

Respeta los permisos de Jira existentes por proyecto — no da acceso de más.

## Flujo Kiritek

1. **Al empezar una historia**: traer el ticket completo (no copiar/pegar
   manualmente) antes de arrancar `spec-driven-dev` — la spec debe basarse en
   la descripción real del ticket, no en un resumen de memoria.
2. **Conversar el entendido**: confirmar con el developer qué entendió la IA
   del ticket vs. lo que el developer entendió, antes de generar spec/plan
   (evita editar la ventana equivocada en proyectos con archivos duplicados).
3. **Branch/commits**: usar la clave del ticket (`TICKET-123`) en el nombre de
   rama y mensajes de commit — ver skill `git-workflow` §Branch Naming. Esto
   es lo que permite el paso 4.
4. **Al cerrar**: escribir comentario en el ticket con lo que se hizo
   (endpoints tocados, decisiones relevantes) — no dejar el ticket mudo
   esperando que alguien lo actualice a mano.
5. **Nunca transicionar el estado del ticket sin confirmación humana** — la IA
   puede sugerir el cambio de estado, no aplicarlo sola, salvo en el flujo de
   auto-asignación de tickets simples que Vladimir/Oscar/Miguel definan
   explícitamente (punto abierto en la propuesta, §10).

---
_Kiritek Framework — skill core `mcp-jira`. Configuración sobre el servidor oficial [atlassian/atlassian-mcp-server](https://github.com/atlassian/atlassian-mcp-server) (Apache-2.0); el contenido de este SKILL.md es propio de Kiritek._
