# Contrato — Integridad de los vectores

**Cubre**: FR-001 a FR-004 (US1) y FR-005 a FR-007 (US2).
**Superficie**: interna. Esta spec **no agrega ni modifica endpoints**; cambia el
comportamiento observable de dos operaciones que ya existen.

---

## 1. La invariante

> **`syncStatus = SYNCED` implica que existe un vector válido para cada fragmento del
> documento.**

Hoy no se cumple: si el servicio de embeddings falla un lote, la librería devuelve
arrays vacíos sin lanzar, se escriben en Chroma y el documento se marca `SYNCED`.

---

## 2. Qué cambia en cada operación

### `POST /knowledge` (alta de documento) y `POST /knowledge/upload`

| Situación | Antes | Ahora |
|---|---|---|
| Vectores OK | 201, documento `SYNCED` | **Igual** |
| Un lote de embeddings falla | 201, documento `SYNCED`, fragmentos rotos en Chroma | **La respuesta HTTP es de error**, no 201. **No se escribe ningún vector en Chroma.** La fila del documento **se conserva** en `REINDEX_FAILED` |
| Fragmento sin vector | Se escribe vacío | **Se aborta antes de escribir** |

> [!IMPORTANT]
> **El documento sobrevive al fallo, y es deliberado.** La alternativa —borrarlo para
> que la operación sea atómica— se descartó por tres razones:
>
> 1. **En `POST /knowledge/upload` el texto ya costó caro.** El worker de ingestión
>    extrajo el contenido del PDF, del Word o de la imagen (Gemini Vision) antes de
>    llegar acá. Perderlo por un 429 obliga a reprocesar el archivo entero.
> 2. **En "responder y enseñar a la IA" no hay a quién devolverle el error.** La
>    respuesta al cliente **ya se envió**; la ingesta es un efecto posterior. Borrar el
>    documento perdería el conocimiento en silencio, que es exactamente el modo de
>    fallo que esta historia vino a eliminar.
> 3. **`REINDEX_FAILED` ya existe y el panel ya lo sabe mostrar**, con su botón de
>    reintentar. No hace falta inventar nada.
>
> **La invariante que importa no es "el documento no existe", es "no hay vectores
> inválidos en el índice".** Un documento sin vectores es recuperable con un clic; un
> documento con vectores rotos marcado `SYNCED` no lo es, porque nadie sabe que está
> roto.
>
> Consecuencia a implementar a conciencia: `ingest()` **crea la fila, falla al
> vectorizar, marca `REINDEX_FAILED` y lanza**. Quien llama decide qué hacer con la
> excepción — y en el camino de escalados, "loguear y seguir" es una respuesta válida
> porque el documento quedó visible para reintentarlo.

### Reindexado (worker `knowledge-reindex`)

| Situación | Antes | Ahora |
|---|---|---|
| Vectores OK | `SYNCED` | **Igual** |
| Un lote falla | `SYNCED` con fragmentos rotos | **Lanza** → BullMQ reintenta (3 intentos, backoff exponencial) |
| Se agotan los reintentos | — (no llegaba a pasar) | `REINDEX_FAILED` + `syncError`, visible en el panel y reintentable con el botón que ya existe |

**Orden obligatorio dentro de `reindex()`**:

```text
1. vectorizar          ← si falla, se corta acá
2. validar             ← la guarda
3. borrar los viejos
4. escribir los nuevos
5. marcar SYNCED
```

Hoy el borrado (3) ocurre **antes** de vectorizar. Mover la validación delante del
borrado es lo que evita que un fallo deje al documento sin fragmentos.

### `GET /knowledge` y el panel

Sin cambios de forma. Un documento que antes aparecía `SYNCED` (mintiendo) ahora puede
aparecer `REINDEX_FAILED` — que es información nueva y correcta, y el panel ya sabe
mostrarla desde el Sprint 5A.

---

## 3. Qué cambia en el vector

```text
texto vectorizado  =  `${document.title}\n\n${fragmento}`
texto devuelto     =  fragmento          ← SIN CAMBIOS
```

### Lo que NO se altera

| Qué | Por qué importa |
|---|---|
| `SearchHit.content` | Es lo que lee el asistente. Si cambiara, cambiaría lo que responde, y nadie pidió eso (FR-006) |
| `SearchHit.title` | Ya venía de la metadata, sigue igual |
| `SearchHit.score` | Sigue siendo `1 - distancia_coseno`. Cambian los **valores**, no la escala ni el significado |
| El filtro de audiencia / área / `isActive` | Punto único del Principio I. **No se toca** (FR-007) |

### Confidencialidad

El título entra al **vector**, no al filtro. Un cliente no puede recuperar un documento
`INTERNO` por su título: la exclusión ocurre en el `where` de la consulta a Chroma,
antes de que la similitud importe. Y el título ya viajaba en la metadata y en
`SearchHit.title` desde el Sprint 5A, así que **no hay superficie de exposición nueva**.

---

## 4. Cómo se verifica

| Requisito | Verificación |
|---|---|
| FR-001..004 | Test unitario: mockear el servicio de embeddings para que devuelva `[]` en un fragmento y verificar que (a) no se llama a `collection.add`, (b) el documento no queda `SYNCED` |
| FR-001..004 | Test unitario: mismo mock con **todos** los vectores válidos → se escribe y queda `SYNCED` |
| Orden en `reindex` | Test unitario: fallo de embeddings → **no** se llamó a `collection.delete` |
| FR-005 | Test unitario: verificar que el texto pasado a `embedDocuments` empieza con el título y que el texto pasado a `collection.add({documents})` **no** |
| FR-006 | Test unitario: `search()` devuelve el fragmento sin el título antepuesto |
| FR-007 | Los tests de audiencia que ya existen tienen que seguir pasando **sin modificarse** — si hay que tocarlos, algo se rompió |
