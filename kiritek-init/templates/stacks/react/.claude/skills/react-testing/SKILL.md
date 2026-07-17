---
name: react-testing
description: Use when writing or reviewing tests for React components — React Testing Library, Jest/Vitest, mocking API calls, and testing hooks.
metadata:
  origin: Propio de Kiritek
---

# React Testing

## Principio

Testing Library: testear como el usuario interactúa, no implementación interna. Si el test se rompe por un refactor que no cambia comportamiento visible, el test está mal escrito.

```jsx
// mal — acopla al detalle de implementación
expect(wrapper.state("isOpen")).toBe(true);

// bien — verifica comportamiento observable
expect(screen.getByRole("dialog")).toBeInTheDocument();
```

## Queries — orden de preferencia

1. `getByRole` (accesible, refleja lo que un screen reader vería)
2. `getByLabelText` (forms)
3. `getByText`
4. `getByTestId` — último recurso, solo si no hay forma semántica de encontrar el elemento

## Interacción de usuario

Usar `userEvent` (no `fireEvent` directo) — simula eventos de navegador reales más fielmente (focus, hover, secuencia de teclado).

```jsx
const user = userEvent.setup();
await user.click(screen.getByRole("button", { name: /guardar/i }));
```

## Mocking de API

- Mockear a nivel de red (MSW — Mock Service Worker), no mockear el módulo del cliente HTTP — así el componente corre su lógica real de fetching/loading/error.
- Nunca dejar un mock global que todos los tests heredan sin darse cuenta — reset entre tests.

## Async

- `findBy*` (no `getBy*`) para elementos que aparecen después de una operación async (fetch, animación).
- Envolver actualizaciones de estado fuera del control de Testing Library en `waitFor`, no `setTimeout` arbitrario.

## Reglas

1. **No "tested/verified" sin output real del test runner** — mismo principio que `git-workflow`.
2. Un test roto por refactor legítimo se actualiza, no se skipea sin ticket que lo justifique.
3. Snapshot tests con moderación — un snapshot gigante que nadie revisa en PR no atrapa bugs, solo genera ruido en diffs.
