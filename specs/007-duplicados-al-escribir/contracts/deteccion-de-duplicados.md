# Contrato — Detección de duplicados (US2, US3, US4)

**Cubre**: FR-010 a FR-025.
**Superficie**: cambia el comportamiento de los cuatro caminos que ya crean documentos.
**No agrega endpoints.**

---

## 1. Las dos detecciones, y por qué en ese orden

```text
1. ¿Es IDÉNTICO a algo que ya existe?     ← barato, cero falsos positivos
      └─ sí → se corta acá, SIN vectorizar (FR-013)
2. ¿Se PARECE a algo que ya existe?       ← cuesta una llamada de embeddings
      └─ sí → se informa, la carga sigue igual
```

El orden no es cosmético: el duplicado exacto **no paga la comparación semántica**. Con
el límite de 100 RPM del nivel gratuito (medido en la spec 006), lo que se carga dos
veces no gasta cuota dos veces.

---

## 2. Duplicado exacto (US2)

### `POST /knowledge` — alta manual

| Situación | Antes | Ahora |
|---|---|---|
| Contenido nuevo | 201 | **Igual** |
| Contenido **idéntico** a uno que ya existe | 201, segundo documento creado | **409**, con **cuál** es el previo: identificador y título |
| Idéntico, pero insistiendo explícitamente | — | 201, se crea igual |

**Es la misma forma que ya usa el rechazo de archivos repetidos**, incluida la razón
identificable y el previo en la respuesta. La clarificación del 2026-08-08 lo dejó
decidido: *"409 es detección, no prohibición… sin saber cuál es, 'ya existe' no le sirve
para decidir"*. Copiar la convención en vez de inventar otra.

### Los caminos automáticos (FR-023)

No hay a quién devolverle un 409, así que el criterio cambia:

| Camino | Ante un duplicado exacto | Ante un fallo de la detección |
|---|---|---|
| Archivo subido (worker) | **No se crea** el segundo documento. El archivo queda apuntando al que ya existía | Se procesa igual |
| Caso resuelto enseñándole a la IA | **No se crea** el segundo documento. **El caso queda apuntando** al que ya existía, marcado como reusado | El caso **igual se resuelve**: el mensaje ya se envió |
| Respuesta guardada sin enviar | Igual que el anterior | Acá **no se envió nada**, así que un fallo real sí puede propagarse. Un duplicado **no es un fallo**: se marca como reusado y termina bien |

> **Los cuatro caminos, o ninguno.** FR-021 los enumera a propósito: alta manual, archivo
> subido, caso resuelto y **respuesta guardada sin enviar**. Este último es el que más
> fácil se olvida —la ingesta es su único efecto, no acompaña a otra cosa— y es
> exactamente la puerta de atrás que la constitución advierte: *"la escritura entra por
> diez caminos… una regla puesta en la ruta o en la pantalla deja la puerta de atrás
> abierta"*.

> **No se crea, y no falla** (FR-024). La operación que lo originó —procesar el archivo,
> resolver el caso— termina bien. Lo único que no ocurre es la creación del duplicado.

---

## 3. Parecido (US3)

### `POST /knowledge` — alta manual

La respuesta gana los documentos parecidos que ya existen: identificador, título y cuán
parecido es cada uno (FR-014, FR-016).

### Reglas

- **No bloquea ni pide confirmación** (FR-015). El documento **se crea**; el aviso
  acompaña al resultado. Ofrecer acciones sobre el parecido es la pre-spec 3.
- **Vacío es lo normal y lo deseable** (SC-005). Si aparece en cada carga, el umbral está
  mal puesto y el aviso ya no sirve.
- **Sin documentos desactivados** (FR-019).
- **Lista acotada** (FR-018).
- **Otra audiencia se distingue** (FR-020): un documento `PUBLICO` y uno `INTERNO` del
  mismo tema son legítimos —uno es lo que se le dice al cliente, el otro lo que sabe el
  empleado— y presentarlos como duplicados llevaría a fusionarlos y a filtrar conocimiento
  interno. Si se informan, va dicho que la audiencia difiere.

### En los caminos automáticos (FR-022)

El hallazgo queda **registrado de forma consultable** en vez de mostrarse: nadie está
mirando la pantalla cuando el worker procesa un archivo.

**Va como evento de orquestación**, con el documento creado y los parecidos encontrados
con su score. `GET /supervisor/events` ya existe desde el Sprint 2, así que es consultable
sin construir nada, y hay precedente directo: la spec 006 usó `escalation_teach_failed`
para exactamente esta forma —algo que pasó, que nadie estaba mirando, y que hay que poder
consultar después—. Ver [data-model.md §4](../data-model.md).

**No dispara nada.** Es información para quien más adelante se pregunte por qué el corpus
tiene dos documentos sobre lo mismo.

---

## 4. Lo que nunca puede pasar

| Regla | Por qué |
|---|---|
| **Una detección no hace fallar la operación** (FR-024) | Es información, no una validación. Que el sistema no pueda opinar sobre parecidos no es motivo para perder el documento |
| **Si la comparación falla, el documento se carga igual** (FR-025) | El servicio de embeddings se cae o agota su cuota: guardar el conocimiento es lo importante |
| **Ninguna operación queda a medias** | O el documento se crea entero, o no se crea. La guarda de la spec 006 ya sostiene esa invariante del lado de los vectores |

---

## 5. El umbral

`KNOWLEDGE_SIMILARITY_THRESHOLD`, por variable de entorno con Joi y **sin default en
código**. Su valor **sale de medir** con `scripts/calibrar-parecido.ts`, no de elegirlo
(FR-017, SC-008).

**No se hereda el 0.65 del RAG**: responde a otra pregunta —cuán bien una consulta corta
encuentra un fragmento— y la distribución de comparar dos documentos enteros es distinta
y más alta. Heredarlo avisaría casi siempre, y ese es el riesgo principal declarado de la
feature.

---

## 6. Cómo se verifica

| Requisito | Verificación |
|---|---|
| FR-010, FR-011 | Test: cargar el mismo contenido dos veces → la segunda es rechazo con el previo identificado |
| FR-012 | Test: insistiendo explícitamente, se crea |
| FR-013 | Test: ante duplicado exacto **no se llama** al servicio de embeddings |
| FR-014, FR-016 | Test: la respuesta trae los parecidos con título y score |
| FR-015 | Test: con parecidos, el documento **igual se crea** |
| FR-019, FR-020 | Test: un desactivado no se informa; uno de otra audiencia se distingue |
| FR-021 | Test: los **cuatro** caminos pasan por la detección — incluida la respuesta guardada sin enviar |
| FR-022 | Test: un parecido hallado por el worker deja un evento consultable |
| FR-023 | Test: caso resuelto con contenido idéntico → **cero** documentos nuevos, y el caso apunta al existente |
| FR-024, FR-025 | Test: con el servicio de comparación fallando, la carga termina bien |
| SC-004, SC-005 | **Con el calibrador**: pares que se solapan avisan, pares que no, no |
