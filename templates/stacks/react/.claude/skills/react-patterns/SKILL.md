---
name: react-patterns
description: Use when writing or reviewing React components — hooks, state management, data fetching, forms, rendering performance, and component architecture. Not for backend/Node code (use node-express-patterns).
metadata:
  origin: Propio de Kiritek
---

# React Patterns

## Componentes

- Function components + hooks, no class components en código nuevo.
- Un componente hace una cosa — si un componente pasa ~150 líneas o mezcla fetching + presentación + lógica de forma, dividir.
- Props tipadas (TypeScript o PropTypes si el proyecto no usa TS) — nunca `any` implícito.

## State management

- `useState`/`useReducer` para estado local del componente.
- Context API para estado compartido de alcance medio (theme, auth de sesión) — **no** para estado que cambia frecuente (causa re-renders en cascada de todo el árbol bajo el Provider).
- Estado de servidor (datos de API) va en una librería de data-fetching (React Query/TanStack Query, SWR), **no** duplicado en `useState` + `useEffect` manual — evita el anti-patrón de fetch-en-useEffect sin cache/loading/error consistente.
- Librería global (Redux/Zustand) solo si hay estado genuinamente compartido entre partes no relacionadas del árbol — no por defecto.

## Hooks — reglas duras

- Nunca hooks condicionales ni dentro de loops — siempre en el top level del componente.
- `useEffect` con array de dependencias completo (usar el lint de `exhaustive-deps`, no silenciarlo sin razón documentada).
- Un `useEffect` para fetch de datos casi siempre es mejor reemplazado por la librería de data-fetching (ver arriba) — evita condiciones de carrera y estados de loading manuales.
- `useMemo`/`useCallback` solo cuando hay un problema de performance medido (re-render costoso, prop a componente memoizado) — no por costumbre en cada función/objeto.

## Forms

- Librería de forms (React Hook Form) para forms con más de 2-3 campos o validación — evita re-render de todo el form en cada keystroke que da el `useState` manual.
- Validación con schema (zod/yup) compartido si el mismo shape se valida también en backend.

## Performance

- `key` estable y único en listas (nunca index si la lista puede reordenarse/filtrarse).
- Code splitting con `React.lazy` + `Suspense` para rutas/vistas grandes.
- Evitar crear objetos/funciones nuevas inline como prop a componentes memoizados (`React.memo`) — rompe la memoización.

## Checklist antes de dar por terminado un componente

- [ ] Sin hooks condicionales, deps de `useEffect` completas
- [ ] Fetching de datos usa la librería de data-fetching del proyecto, no `useEffect` manual
- [ ] Props tipadas
- [ ] `key` en listas es estable
- [ ] Accesibilidad básica: labels en inputs, roles semánticos, contraste
