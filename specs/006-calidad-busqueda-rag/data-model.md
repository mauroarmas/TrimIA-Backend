# Data Model — Fase 1 · spec 006

**Cero cambios de esquema.** No hay migración de Prisma, no hay campos nuevos, no hay
enums nuevos. Lo que cambia es **con qué texto se calcula el vector** de cada fragmento
y **cuándo se considera válido escribirlo**.

Esto es deliberado: el trabajo es de integridad y de calidad de recuperación, no de
modelo.

---

## 1. Lo que ya existe y esta spec usa

### `KnowledgeDocument` (Postgres)

| Campo | Hoy | Qué cambia |
|---|---|---|
| `title` | Se guarda y viaja a la metadata de Chroma como etiqueta | **Pasa a formar parte del texto que se vectoriza.** Sigue guardándose igual |
| `content` | El texto que se parte en fragmentos y se vectoriza | Sin cambios en el dato. Cambia lo que se le antepone al vectorizar |
| `syncStatus` | `SYNCED` \| `PENDING_REINDEX` \| `REINDEX_FAILED` | Sin cambios en el enum. **Cambia cuándo se llega a cada uno**: un fallo de embeddings ahora lleva a `REINDEX_FAILED` en vez de a `SYNCED` |
| `syncError` | Motivo del último fallo (500 chars) | Pasa a recibir también el motivo "faltaron vectores" |
| `version` | Se incrementa al editar | Sin cambios |
| `vectorId` | `"{docId}:*"` | Sin cambios |

### Fragmento en ChromaDB

| Parte | Hoy | Qué cambia |
|---|---|---|
| `ids` | `"{docId}:{idx}"` | Sin cambios |
| `documents` | El texto del fragmento | **Sin cambios** — es lo que lee el agente (FR-006) |
| `embeddings` | Vector de `chunk` | **Vector de `título + chunk`** (FR-005) |
| `metadatas` | `documentId`, `title`, `category`, `audience`, `agentType`, `chunkIndex`, `isActive`, `version` | Sin cambios |

> [!IMPORTANT]
> **`documents` y `embeddings` dejan de corresponderse exactamente**, y es a propósito:
> el vector se calcula sobre un texto enriquecido, el contenido que se devuelve es el
> original. Es lo que permite mejorar el recall sin cambiar lo que el asistente lee ni
> lo que el panel muestra.

---

## 2. El texto a vectorizar

```text
ANTES:   embed( chunk )
AHORA:   embed( `${title}\n\n${chunk}` )
```

Se aplica a **todos** los fragmentos del documento, no solo al primero: un documento
largo tiene fragmentos cuyo cuerpo no menciona el tema, y son justamente los que más
se benefician.

**Lo que NO entra**: categoría ni agente. Son etiquetas cortas y repetidas; el riesgo
de que acerquen entre sí a todos los documentos de un área es real y no se midió
([research.md](./research.md) §3).

---

## 3. Estados de sincronización — el cambio de verdad

El enum no cambia; cambia **qué transiciones son posibles**.

### Hoy

```text
  ingest / reindex
         │
         ├── embeddings OK ──────────────► SYNCED
         │
         └── un lote falla ──► vectores vacíos ──► SYNCED  ⚠️
                                                    │
                                          el documento está roto
                                          y el panel lo muestra sano
```

### Con esta spec

```text
  ingest / reindex
         │
         ├── todos los vectores válidos ──────────► SYNCED
         │
         └── falta alguno / alguno vacío ──► ERROR
                                              │
                    ┌─────────────────────────┴──────────────────┐
                    │                                            │
              en `ingest`                                 en `reindex`
                    │                                            │
         no se crea el documento                    BullMQ reintenta (3, backoff)
         ni se escribe en Chroma                              │
                                                    ┌─────────┴─────────┐
                                                 sale bien          se agota
                                                    │                  │
                                                 SYNCED         REINDEX_FAILED
                                                                 + syncError
```

**La invariante que esta spec instala**: `SYNCED` implica que existe un vector válido
por cada fragmento. Hoy no se cumple y nada lo delata.

### Nota sobre el orden en `reindex`

`reindex()` borra los fragmentos viejos **antes** de agregar los nuevos, a propósito
(para no dejar dos versiones conviviendo). Eso significa que un fallo de embeddings
deja al documento **sin fragmentos** hasta que un reintento tenga éxito.

Es aceptable y coherente con el diseño que ya existe —`REINDEX_FAILED` es visible y
reintentable—, pero hay que decidirlo a conciencia: **la guarda tiene que ir antes del
`delete`**, no entre el `delete` y el `add`. Si se vectoriza primero y se valida
después, un fallo cuesta el corpus del documento; si se valida primero, no cuesta nada.

---

## 4. Migración del corpus (US3)

No mueve datos: recalcula vectores.

| Aspecto | Decisión |
|---|---|
| Alcance | Los 78 documentos activos |
| Mecanismo | La cola `knowledge-reindex` que ya existe, un job por documento |
| Reanudable | Sí: un documento ya migrado se detecta por `syncStatus = SYNCED` **más** un marcador de corrida, o simplemente re-procesándolo (es idempotente) |
| Fallo individual | No detiene la migración; el documento queda en `REINDEX_FAILED` para revisión |
| Ritmo | **A decidir en la implementación.** El spike hizo fallar a la API con dos pasadas seguidas sobre el corpus; encolar 78 jobs de golpe repite ese perfil |

> [!WARNING]
> **El ritmo no es un detalle de implementación, es parte del diseño.** La evidencia de
> la Fase 0 es que este corpus, a este ritmo, **hace fallar la API**. Sin la guarda,
> ese fallo se traduce hoy en documentos rotos marcados como sanos. Con la guarda, se
> traduce en documentos en `REINDEX_FAILED` — visible, pero igual de molesto si son
> muchos. `concurrency: 1` en el worker ayuda; puede hacer falta además espaciar el
> encolado.

---

## 5. Consultas de control (US4)

No es una entidad persistida: es un archivo de datos del arnés de medición.

| Campo | Para qué |
|---|---|
| `consulta` | El texto que se busca |
| `esperado` | Cómo reconocer el documento correcto, o `null` si la consulta es deliberadamente irrelevante |
| `nota` | De dónde salió (qué defecto real la motivó) |

Semilla, tomada de la Fase 0:

| Consulta | Esperado | Origen |
|---|---|---|
| `"arbol"` | `null` — mide el piso de ruido | El caso que abrió esta spec |
| `"qué es Credimisión"` | «Qué es Credimisión» / «Sobre Nosotros» | Control positivo, hoy pasa con 75-79% |
| `"qué sabes sobre la empresa?"` | «Qué es Credimisión» / «Sobre Nosotros» | El defecto del 2026-08-20. **Se espera que siga fallando**: su causa es la competencia entre documentos (pre-spec 2/3) |
| `"que garantia tienen las heladeras?"` | «Garantía extendida…» | Control positivo, hoy 75.8% |

**El tercero es el más valioso del conjunto** justamente porque falla: fija por escrito
qué problema esta spec **no** resuelve, para que nadie lo dé por arreglado.
