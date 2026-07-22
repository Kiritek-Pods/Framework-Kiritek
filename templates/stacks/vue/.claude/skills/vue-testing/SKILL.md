---
name: vue-testing
description: Use when writing or reviewing tests for Vue components — Vue Test Utils, Vitest/Jest, mocking API calls, and testing composables.
metadata:
  origin: Propio de Kiritek
---

# Vue Testing

## Principio

Testear como el usuario interactúa con el componente montado, no implementación interna. Si el test se rompe por un refactor que no cambia comportamiento visible, el test está mal escrito.

```js
// mal — acopla al detalle de implementación
expect(wrapper.vm.isOpen).toBe(true);

// bien — verifica comportamiento observable
expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
```

## Vue Test Utils

- `mount()` para tests de integración (renderiza hijos reales), `shallowMount()` solo cuando los hijos son irrelevantes para lo que se testea y ensucian el output.
- Buscar elementos por atributo semántico (`role`, `data-testid` si no hay nada semántico) antes que por clase CSS — una clase que cambia de estilo no debería romper el test.

```js
const wrapper = mount(BookingForm);
await wrapper.find('button[type="submit"]').trigger('click');
expect(wrapper.emitted('submit')).toBeTruthy();
```

## Composables

Un composable con estado se testea invocándolo dentro de un componente de prueba mínimo (o con `@vue/test-utils` + `withSetup` helper) — nunca llamando `ref()`/`computed()` fuera de un contexto de componente, revienta en runtime real aunque el test lo permita.

## Mocking de API

- Mockear a nivel de red (MSW), no el módulo del cliente HTTP — así el componente corre su lógica real de fetching/loading/error.
- Reset de mocks entre tests, nunca un mock global heredado sin darse cuenta.

## Async

- `await nextTick()` (o `await wrapper.vm.$nextTick()`) después de una acción que dispara reactividad antes de aserciones — Vue actualiza el DOM async.
- Para fetch/promesas: `await flushPromises()` de test-utils, no `setTimeout` arbitrario.

## Reglas

1. **No "tested/verified" sin output real del test runner** — mismo principio que `git-workflow`.
2. Un test roto por refactor legítimo se actualiza, no se skipea sin ticket que lo justifique.
3. Snapshot tests con moderación — uno gigante que nadie revisa en PR no atrapa bugs, solo genera ruido en diffs.
