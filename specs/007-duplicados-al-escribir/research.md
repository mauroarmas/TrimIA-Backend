# Research — Fase 0 · spec 007

**Fecha**: 2026-08-22 · **Método**: lectura del código existente. Sin spikes: a
diferencia de la spec 006, acá no hay ninguna afirmación sobre el comportamiento de un
proveedor externo que verificar — todas las piezas son propias.

---

## 1. Cómo se llega desde un caso a los documentos que quedaron cortos

**Decisión: enlazar `KnowledgeRetrieval` con la `Escalation`, no correlacionar por tiempo.**

### El problema

US1 necesita, dado un caso escalado, **qué documentos se consultaron y no alcanzaron**.
`KnowledgeRetrieval` los tiene (documento, score, rank, `outcome: ESCALATED`) pero se
enlaza por **conversación**, no por caso. Y una conversación puede escalar, resolverse y
volver a escalar, así que "los retrievals de esta conversación" no distingue de cuál caso.

### Por qué el enlace exacto es posible

El orden real de las operaciones lo permite:

```text
1. rag-agent.graph.ts:217  →  escalations.create({...})   ← DENTRO del grafo
                              devuelve la Escalation
2. (el grafo termina, el processor envía la respuesta)
3. message.processor.ts:213 →  trackRetrievals({...})     ← DESPUÉS
```

La escalación se crea **antes** de que se registren los retrievals, y `create()`
**devuelve** el registro. Así que su id puede viajar por el estado del orquestador hasta
`trackRetrievals`, igual que ya viajan `retrievedDocs` y `escalated`.

### Un detalle que juega a favor

`escalations.create()` **no duplica**: si ya hay una `PENDING` para esa conversación,
devuelve la existente ([`escalations.service.ts:83`](../../src/escalations/escalations.service.ts#L83)).
Consecuencia útil: los retrievals de **todos** los turnos que siguieron estancados se
enlazan al **mismo** caso. El supervisor no ve solo el último intento fallido, ve todo lo
que se consultó mientras la conversación estuvo trabada.

### Alternativas consideradas

| Opción | Veredicto |
|---|---|
| **Enlace `escalationId` en `KnowledgeRetrieval`** | **Elegida.** Exacto, sin duplicar datos, y el orden de las operaciones ya lo permite. Nullable: los turnos que responden bien no tienen caso |
| Correlacionar por `conversationId` + ventana de tiempo | Frágil con escalaciones repetidas, y **no hay índice por `conversationId`** — sería un scan |
| Guardar una foto de los documentos en la `Escalation` | Duplica lo que `KnowledgeRetrieval` ya tiene, y hay que mantener las dos copias |

### Lo que hay que tocar

`orchestrator.state.ts` (un campo), los **dos** caminos de escalado de
`rag-agent.graph.ts` (líneas 217 y 249), `message.processor.ts` y
`orchestration-logger.service.ts`. Es cableado, pero pasa por cinco archivos: conviene
tenerlo presente al estimar.

---

## 2. La propuesta de corrección: se reusa entera

**Decisión: usar `KnowledgeAiEditService` tal cual, sin modificarlo.**

`preview(id, instruction)` recibe un documento y una instrucción en lenguaje natural, y
devuelve `{ baseVersion, proposedContent, summary, changedSections, confident }`
**sin persistir nada**. `apply(id, { baseVersion, content, instruction }, employeeId)`
guarda **el texto del body** —que puede venir corregido a mano— y nunca uno regenerado.

Para US1 la instrucción se arma con la respuesta que el supervisor escribió: *"incorporá
esta información: …"*. El documento sale del paso 1.

### Tres cosas que ya vienen resueltas y no hay que rehacer

- **La aprobación es estructural, no una regla.** Son dos endpoints y el primero no
  escribe: "nunca se aplica sin aprobación" es imposible de violar por descuido.
- **`confident: false`.** Si el modelo no puede determinar qué tocar, devuelve el
  contenido **original** y `changedSections` vacío. US1 hereda ese camino: si no hay
  propuesta, el supervisor crea un documento nuevo como hasta ahora (FR-007).
- **El conflicto de versión (FR-008) ya existe.** `expectedVersion !== current.version`
  → 409 `VERSION_CONFLICT` con la versión actual
  ([`knowledge.service.ts:657`](../../src/ai/knowledge/knowledge.service.ts#L657)).
  **No hay nada que construir para FR-008.**

### Alternativa considerada

Generar la corrección con un prompt propio, más específico para "vino de un caso
escalado". Descartada: duplicaría el prompt de edición y la salvaguarda de
`confident: false`, y las dos tendrían que mantenerse en paralelo.

---

## 3. El duplicado exacto: el `checksum` ya está, falta leerlo

**Decisión: usar el `checksum` que ya se calcula, con un índice nuevo.**

`KnowledgeDocument.checksum` se calcula en cada `ingest()` y **nunca se consulta**: no
hay índice, no hay unique, nadie lo lee. Es la comparación más barata que existe y está
tirada.

⚠️ **No confundirlo con `KnowledgeFile.checksum`**, que sí se usa y sí tiene índice, pero
es el hash del **binario**. Dos archivos distintos con el mismo texto extraído tienen
checksums de archivo distintos y de documento iguales — que es exactamente el caso que
esta spec cubre y aquél no.

### La convención de qué hacer con él, ya decidida

`assertNotDuplicate` para archivos repetidos deja escrito el criterio del proyecto
([`knowledge-ingestion.service.ts:218`](../../src/ai/knowledge/knowledge-ingestion.service.ts#L218)):

> *"409 es **detección, no prohibición** (clarificación 2026-08-08): con `?force=true` el
> supervisor lo sube igual y se hace cargo. Por eso la respuesta incluye el archivo
> previo — sin saber cuál es, 'ya existe' no le sirve para decidir."*

FR-011 y FR-012 lo replican para documentos. **No se inventa un mecanismo nuevo para el
mismo problema**; se copia la forma, incluido devolver cuál es el previo.

### Lo que el checksum NO resuelve

Dos textos que difieren en un espacio o en una mayúscula dan checksums distintos y son
duplicados para cualquiera que los lea. **Se acepta**: normalizar antes de hashear
(espacios, mayúsculas, acentos) es una decisión con efectos secundarios —dos documentos
que difieren solo en formato dejarían de poder coexistir a propósito— y no hay evidencia
de que el caso ocurra. Lo cubre la detección de parecidos, con su score alto.

---

## 4. El umbral de parecido: se mide, no se hereda

**Decisión: calibrarlo con una medición propia, con el método de la spec 006.**

### Por qué no sirve el 0.65 del RAG

Responden preguntas distintas:

| Umbral | Compara | Distribución |
|---|---|---|
| `RAG_CONFIDENCE_THRESHOLD` (0.65) | una **consulta corta** contra fragmentos | ruido 54%, señal 78% (medido) |
| El de esta spec | un **documento entero** contra otro | **sin medir** |

Dos textos largos del mismo dominio se parecen entre sí bastante más de lo que una
consulta corta se parece a cualquiera. Heredar 0.65 avisaría casi siempre — y **un aviso
que aparece siempre es invisible en una semana**, que es el riesgo principal declarado de
la feature.

### El método

El mismo que la 006: un conjunto de pares con relevancia conocida, medido con un comando
repetible que queda en el repo (`scripts/calibrar-parecido.ts`).

Los pares de arranque salen del corpus real, donde el caso ya está identificado:

| Par | Qué debería dar |
|---|---|
| «Sobre Nosotros» ↔ «Qué es Credimisión» | **Alto** — son el duplicado real del 2026-08-20 |
| «Garantia extendida» ↔ «Devoluciones, cambios y garantía» | **Alto** — se solapan |
| «Envíos» ↔ «Monto mínimo de compra» | **Bajo** — mismo dominio, temas distintos |
| Un documento contra sí mismo | ~1.0, control de cordura |
| Documentos de áreas distintas sin relación | **Bajo**, marca el piso |

### Dónde vive el valor

Variable de entorno validada con Joi y **sin default en código**, la regla de `CLAUDE.md`
que la spec 006 acaba de hacer cumplir quitando un `0.65` de `supervisor.service.ts`.

---

## 5. Dónde queda el registro de "se resolvió sin crear"

**Decisión: en el caso, no en el corpus.**

FR-023 pide que, ante un duplicado exacto en un camino automático, no se cree el segundo
documento y quede constancia **en el caso que lo originó**, apuntando a cuál era el
conocimiento que ya existía.

Un documento apunta a **un solo** caso (`sourceType`/`sourceId`, spec 003), así que
reusar el existente perdería la traza del segundo caso y crear uno nuevo sería el
duplicado que la spec viene a evitar. La salida es que el dato viva del otro lado de la
relación: el caso sabe con qué documento se resolvió.

Es el mismo criterio que la spec 006 usó para `escalation_teach_failed`: **la información
vive donde alguien la va a buscar**. Nadie va a mirar el corpus para entender cómo se
resolvió un caso; va a mirar el caso.

Y sirve para las dos historias, que son la misma forma:

| Situación | Qué se registra |
|---|---|
| US1 — se corrigió un documento existente | el caso apunta al documento corregido |
| FR-023 — se reusó uno idéntico | el caso apunta al documento que ya existía |
| Hoy — se creó uno nuevo | el documento apunta al caso (`sourceId`), como hasta ahora |

### Alternativa considerada

Un evento de orquestación, como `escalation_teach_failed`. Descartada para este caso: un
evento sirve para algo que **pasó y se mira una vez**; esto es un dato del caso que hay
que poder consultar después, y en el panel de un caso resuelto tiene que verse sin
buscar en la bitácora.

---

## 6. Lo que esta investigación NO tuvo que resolver

Vale dejarlo escrito, porque es reutilización real y no aparente:

| Lo que podría haber sido trabajo | Por qué no lo es |
|---|---|
| El conflicto de versión (FR-008) | `expectedVersion` ya lo hace, con 409 y todo |
| La aprobación explícita (FR-003, FR-004) | `preview`/`apply` ya la garantizan por construcción |
| La autorización por área (FR-006) | `assertPuedeEscribir` ya existe y está testeada |
| Qué documentos se consultaron | `KnowledgeRetrieval` ya los guarda con score y desenlace |
| La convención de avisar sin prohibir (FR-012) | Decidida el 2026-08-08 y ya implementada para archivos |
