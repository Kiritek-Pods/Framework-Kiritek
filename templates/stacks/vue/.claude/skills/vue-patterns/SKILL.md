---
name: vue-patterns
description: Use when writing or reviewing Vue components — Composition API, reactivity, state management (Pinia), routing, forms, and rendering performance. Not for backend/Node code (use node-express-patterns) or React code (use react-patterns).
metadata:
  origin: Propio de Kiritek
---

# Vue Patterns

## Componentes

- **Composition API + `<script setup>`** en código nuevo, no Options API — más fácil de componer y tipar con TypeScript.
- Un componente hace una cosa — si mezcla fetching + presentación + lógica de forma compleja, dividir en componentes más chicos o extraer a un composable.
- Props tipadas con `defineProps<{...}>()` (TS) — nunca `any` implícito.

## Reactividad — reglas duras

- `ref()` para valores primitivos, `reactive()` para objetos — no mezclar sin razón, y no desestructurar un `reactive()` directo (pierde reactividad; usar `toRefs`).
- `computed()` para derivar estado, nunca recalcular manualmente en el template ni en un `watch` que solo copia un valor derivado.
- `watch`/`watchEffect` solo para side-effects reales (fetch, sincronizar con algo externo) — si es solo derivar un valor, es un `computed`, no un `watch`.

## State management

- Estado local del componente: `ref`/`reactive`.
- Estado compartido entre componentes no relacionados: **Pinia** (no Vuex en proyectos nuevos).
- Estado de servidor (datos de API): librería de data-fetching (TanStack Query for Vue, o un composable propio con cache/loading/error consistente) — evitar el anti-patrón de `fetch` manual en `onMounted` sin manejo de estados.

## Composables

- Lógica reutilizable con estado (no solo funciones puras) va en un composable `useX()`, no copiada entre componentes.
- Un composable retorna `refs`/`computed`, nunca objetos planos que rompan reactividad al desestructurar.

## Forms

- Librería de forms (VeeValidate, FormKit) para forms con validación no trivial — evita reinventar manejo de errores/touched/dirty a mano.
- Validación con schema (zod/yup) compartido si el mismo shape se valida también en backend.

## Performance

- `key` estable en `v-for` (nunca `index` si la lista puede reordenarse/filtrarse).
- `v-once`/`v-memo` solo cuando hay un problema de performance medido, no por costumbre.
- Componentes async (`defineAsyncComponent`) + lazy routes para code splitting de vistas grandes.

## Checklist antes de dar por terminado un componente

- [ ] Composition API + `<script setup>`, props tipadas
- [ ] Sin desestructurar `reactive()` directo
- [ ] Fetching de datos usa la librería de data-fetching del proyecto, no `fetch` manual en `onMounted`
- [ ] `key` en `v-for` es estable
- [ ] Accesibilidad básica: labels en inputs, roles semánticos, contraste
