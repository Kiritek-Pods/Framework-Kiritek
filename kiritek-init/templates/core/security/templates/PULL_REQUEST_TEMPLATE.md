<!--
  Plantilla de Pull Request — Kiritek core (provider-neutral).

  Reglas (Requisitos 18.1, 18.3, 18.5):
  - Mantén SÓLO las secciones de abajo. No agregues campos.
  - NO pegues secretos, tokens, credenciales, dumps, prompts completos ni
    logs sin redactar. Enlaza evidencia redactada en su lugar.
  - Una afirmación "verificado/tested/working" exige evidencia vigente del
    mismo commit/alcance (ver `kiritek-init validate` y el Requisito 11).
    Si no la tienes, usa un estado honesto: no_ejecutado / parcial / fallido.
-->

## Ticket

<!-- Clave del ticket (p. ej. ABC-123) o `N/A — <razón breve>`. -->

## Resumen y riesgo

<!-- Qué cambia y por qué, en una o dos frases. Nivel de riesgo y por qué. -->

## Evidencia de pruebas y seguridad

<!--
  Resultado de pruebas y escaneos de seguridad. Pega comando + exit code +
  resumen redactado, o enlaza al reporte redactado. NO pegues logs crudos ni
  valores de secretos. Si no se ejecutó algo, dilo (estado honesto).
-->

- Estado: <!-- verificado | parcial | no_ejecutado | fallido -->
- Evidencia: <!-- comando, versión/config-hash, alcance, exit code, enlace al reporte redactado -->

## Impacto en secretos y datos

<!--
  ¿Toca manejo de secretos, credenciales, PII o datos sensibles? Describe el
  impacto SIN incluir los valores. `N/A — <razón breve>` si no aplica.
-->

## Plan de rollback

<!--
  Cómo revertir si falla en producción. `N/A — <razón breve>` cuando no aplique
  (p. ej. cambio sin efecto en runtime).
-->
