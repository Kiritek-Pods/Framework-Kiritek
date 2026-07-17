---
description: Instala las piezas de Kiritek que no vienen como skill del plugin — Graphify (indexado de código) y claude-mem-lite (memoria persistente por proyecto).
---

Instalar en el proyecto actual, en este orden, confirmando con el usuario antes de cada paso si algo ya existe:

1. **`.graphifyignore`** — si no existe en la raíz del proyecto, copiar el de este plugin (`.graphifyignore`). Si ya existe, no sobreescribir; avisar al usuario.

2. **Graphify** (indexado de código + docs):
   ```bash
   command -v graphify >/dev/null 2>&1 || uv tool install graphifyy
   graphify install         # genera su propio skill/slash-command /graphify
   graphify claude install  # escribe hooks PreToolUse + nota en CLAUDE.md
   ```
   No correr `graphify .` (primer build del grafo) automáticamente — dejarlo para el primer uso real, o preguntar al usuario si lo quiere correr ahora.

3. **claude-mem-lite** (memoria persistente, project-scoped):
   Ver instrucciones de instalación en https://github.com/sdsrss/claude-mem-lite — requiere Linux/macOS. Si el proyecto ya tiene memoria configurada, no reinstalar.

Al terminar, resumir qué se instaló y qué quedó pendiente de confirmación del usuario. No correr nada de esto sin que el usuario haya invocado este comando explícitamente.
