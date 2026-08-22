# Contrato — Medición del umbral

**Cubre**: FR-011 y FR-012 (US4), y la verificación de US2.
**Superficie**: un comando, no un endpoint. No se expone por HTTP.

---

## 1. Qué problema resuelve

La Fase 0 midió el umbral a mano y el resultado fue que **0.65 está bien puesto**:

| Qué | Score |
|---|---|
| Piso de ruido (consulta irrelevante) | 52.2 – 54.3% |
| Señal (consulta con respuesta clara) | 75.2 – 78.5% |
| Umbral configurado | 65% |

El problema no es el valor: es que esa medición fue artesanal y **no queda nada que
permita repetirla**. Cada pre-spec siguiente del Sprint 5B mueve los scores —el título
ya los mueve— y sin un arnés cada una vuelve a medir a ojo.

---

## 2. Forma del comando

```bash
docker compose exec nestjs npx ts-node scripts/medir-umbral.ts
```

**No es `npm test`** y no debe serlo: depende de la red, consume tokens y tarda. Un
test unitario que llama a Gemini deja de ser un test unitario.

### Dónde vive, y por qué ahí

`scripts/` es un directorio **nuevo**. Las tres alternativas y por qué se descartaron:

| Ubicación | Por qué no |
|---|---|
| `prisma/` | Es donde viven hoy los scripts de una sola vez (`backfill-chunk-metadata.ts`, `limpiar-conversaciones.ts`), pero **esto no toca el esquema ni es de una sola vez**: es un instrumento que se vuelve a correr. Dentro de seis meses, un medidor de RAG en `prisma/` confunde |
| `test/` | El directorio **no existe** y `package.json` ya tiene un `test:e2e` apuntando a un `test/jest-e2e.json` inexistente. Crearlo a medias empeora una inconsistencia que ya está |
| `src/` | Lo tomaría `nest build` y quedaría en el bundle de producción |

`scripts/` además es el hogar natural del **banco de escenarios del Sprint 5C**, que
también necesita un comando aparte de `npm test` (tarea 5C.13).

> **Jest no lo va a levantar**: la configuración usa `rootDir: "src"` y
> `testRegex: ".*\\.spec\\.ts$"`. Nada fuera de `src/` con nombre distinto de
> `*.spec.ts` entra en `npm test`. La separación está garantizada por configuración,
> no por disciplina.

### Cómo obtiene el `KnowledgeService`

El arnés **debe medir el camino real**, no una reimplementación de la consulta. Si
consultara ChromaDB por su cuenta, se saltearía el filtro de audiencia, el de área y el
de `isActive` — y mediría un sistema que no existe.

```ts
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const knowledge = app.get(KnowledgeService);
// … medir …
await app.close();
```

Arranca el contenedor de Nest completo (Prisma, Redis, la cola de reindexado). Es más
pesado que instanciar a mano, y es el precio de medir lo que realmente pasa. **Cerrar
el contexto al terminar**: si no, el proceso queda colgado por las conexiones de BullMQ.

### Qué reporta

Para cada consulta de control:

- el mejor score obtenido,
- la posición del documento esperado (o "no aparece"),
- si cruza el umbral configurado.

Y un resumen:

- **piso de ruido**: el mejor score entre las consultas marcadas como irrelevantes,
- **señal**: el peor score entre los documentos correctos de las consultas positivas,
- **veredicto**: si el umbral configurado cae entre los dos.

### Lectura del veredicto

| Resultado | Qué significa |
|---|---|
| ruido `<` umbral `<` señal | El umbral separa. Nada que hacer |
| umbral `≤` ruido | Deja pasar respuestas sin fundamento — el agente contestaría con ruido |
| umbral `≥` señal | Escala consultas que el corpus sí puede responder |

---

## 3. Las consultas de control

Viven en un archivo de datos junto al arnés, no dentro del código. Semilla en
[`data-model.md`](../data-model.md) §5.

**Regla de la que conviene no apartarse**: cada consulta anota **de qué defecto real
salió**. Un conjunto de consultas inventadas mide un sistema imaginario.

### La consulta que tiene que seguir fallando

`"qué sabes sobre la empresa?"` está en el conjunto **esperando fallar** (61.1% con el
título incorporado, bajo el umbral). Su causa es la competencia entre dos documentos
del mismo tema, que es materia de las pre-specs 2 y 3.

Está ahí para que nadie dé por resuelto lo que esta spec no resuelve. Si algún día
pasa, será porque la pre-spec 3 funcionó — y el arnés lo va a mostrar.

---

## 4. Comparación antes/después (verificación de US2)

Para SC-002 hace falta comparar contra el estado previo. Dos formas:

| Opción | Veredicto |
|---|---|
| Correr el arnés **antes** de migrar y guardar la salida como línea de base | **Recomendada.** Cuesta una corrida y da la comparación exacta sobre el corpus real |
| Comparar contra los números de la Fase 0 | Sirve de referencia, pero se midió sobre una muestra de 8 documentos, no sobre los 78 |

La línea de base se guarda en [`quickstart.md`](../quickstart.md), que es lo que el
**banco de escenarios del Sprint 5C** va a usar como punto de partida.

---

## 5. Lo que este arnés NO es

- **No es un banco de escenarios.** No prueba el comportamiento del asistente, solo la
  recuperación. Eso es el Sprint 5C.
- **No es una puerta de calidad.** No bloquea nada. Informa.
- **No reemplaza a los tests unitarios.** La guarda de integridad se testea con Jest,
  determinístico y sin red.
