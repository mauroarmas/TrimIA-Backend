# Quickstart — verificar la spec 006

Cómo comprobar a mano que los tres cambios funcionan. **Este archivo también guarda la
línea de base** contra la que se compara, y que el banco de escenarios del Sprint 5C va
a heredar.

## Prerrequisitos

```bash
docker compose up -d
docker compose exec nestjs npx prisma db push   # solo si cambió schema.prisma
curl http://localhost:3000/health
```

Con el corpus real cargado (78 documentos activos al 2026-08-22).

---

## 0. Línea de base — ANTES de tocar nada

> [!IMPORTANT]
> **Correr esto primero.** Una vez migrado el corpus no se puede volver a medir el
> estado previo sin revertir. Sin línea de base, SC-002 no se puede verificar.

```bash
docker compose exec nestjs npx ts-node <ruta>/medir-umbral.ts | tee specs/006-calidad-busqueda-rag/linea-base.txt
```

### Lo que ya se midió en la Fase 0

Sobre una muestra de 8 documentos, no sobre los 78 — sirve de referencia, no de línea
de base formal:

| Consulta | Score | Posición del correcto |
|---|---|---|
| `"arbol"` (irrelevante) | 54.3% | — piso de ruido |
| `"qué es Credimisión"` | 75.2% | 1 ✅ |
| `"que garantia tienen las heladeras?"` | 75.8% | 2 ✅ |
| `"qué sabes sobre la empresa?"` | 59.7% | **3** ❌ no llega al umbral |

---

## 1. La guarda de integridad (US1)

### Automático

```bash
docker compose exec nestjs npm test -- knowledge.service
```

Tiene que cubrir: fragmento sin vector → no se escribe en Chroma, no queda `SYNCED`; y
en `reindex`, que **no se llamó a `delete`**.

### A mano — el caso que motivó todo

La forma honesta de probarlo es provocar el fallo real. Con una API key inválida
temporal:

```bash
docker compose exec -e GOOGLE_API_KEY=invalida nestjs \
  npx ts-node -e "…llamar a ingest con un documento de prueba…"
```

**Antes**: el documento quedaba `SYNCED` con fragmentos rotos.
**Ahora**: la operación falla y el documento queda `REINDEX_FAILED` (o no se crea,
según lo que se decida en el contrato), visible en el panel.

Verificar en el panel → Base de Conocimiento → el documento aparece con estado de
error y botón de reintentar.

---

## 2. El título en el vector (US2)

### Que el contenido devuelto NO cambió

```bash
curl -s -X POST http://localhost:3000/knowledge/search \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"garantia heladeras","audience":"PUBLICO"}' | jq '.[0].content'
```

El `content` tiene que empezar con el texto del documento, **no** con su título. Si
empieza con el título, se rompió FR-006 y el asistente está leyendo algo distinto.

### Que la recuperación mejoró

En el panel → Base de Conocimiento → **Probar búsqueda**:

| Consulta | Antes | Se espera |
|---|---|---|
| `"qué sabes sobre la empresa?"` | correcto en posición 3, 59.7% | **posición 1**, ~61% |
| `"qué es Credimisión"` | posición 1, 75.2% | posición 1, **~78%** |
| `"arbol"` | 54.3% | **no más de 54.3%** — el ruido no debe subir |

> [!NOTE]
> `"qué sabes sobre la empresa?"` **sigue sin cruzar el umbral**, y está bien. Mejora la
> posición, no el veredicto. Su causa es que dos documentos del mismo tema se reparten
> la señal — pre-specs 2 y 3 del Sprint 5B. Si alguien lo da por arreglado acá, se va a
> llevar una sorpresa.

---

## 3. La migración del corpus (US3)

```bash
# Dry-run primero — no escribe nada
docker compose exec nestjs npx ts-node prisma/reindex-corpus.ts

# Aplicar
docker compose exec nestjs npx ts-node prisma/reindex-corpus.ts --apply
```

Seguir el avance:

```bash
docker compose logs nestjs -f | grep -i reindex
```

### Verificar que terminó bien

```sql
SELECT "syncStatus", count(*) FROM "KnowledgeDocument" WHERE "isActive" GROUP BY 1;
```

Esperado: todo en `SYNCED`. Cualquier `REINDEX_FAILED` es un documento que hay que
mirar — el motivo está en `syncError`.

> [!WARNING]
> **La API falló en la Fase 0** con un perfil de carga parecido (98 vectores vacíos en
> una corrida sobre este mismo corpus). Si aparecen varios `REINDEX_FAILED`, no es un
> bug del código: es cuota. Reintentar desde el panel, más espaciado.
>
> Que ahora aparezcan como fallidos **en vez de como sanos** es precisamente lo que US1
> vino a lograr.

### Comprobar que un documento quedó con el título en el vector

No se puede leer el vector directamente. Se comprueba por su efecto: repetir la
consulta `"qué sabes sobre la empresa?"` y ver que el documento correcto subió de
posición.

---

## 4. La medición repetible (US4)

```bash
docker compose exec nestjs npx ts-node <ruta>/medir-umbral.ts
```

Comparar contra `linea-base.txt` del paso 0. Se espera:

- piso de ruido **igual o menor**,
- señal **igual o mayor**,
- umbral 0.65 sigue separando los dos grupos.

Si el umbral dejara de separar, **no cambiarlo sin escribir por qué**: el valor está
respaldado por la medición de la Fase 0 y moverlo sin evidencia nueva empeora las cosas.

---

## Registro de la validación manual

> Completar al implementar. Es la línea de base del banco de escenarios del Sprint 5C
> ([`sprints/5C-capacitacion-audio-medicion/banco-de-escenarios.md`](../../sprints/5C-capacitacion-audio-medicion/banco-de-escenarios.md)),
> y lo único que va a quedar de esta verificación cuando nadie se acuerde.

### Resultado de la implementación — 2026-08-22

**Corpus**: 78 documentos activos · **Migración**: 78/78 → `SYNCED`, cero fallos.

| Consulta | Línea de base | Post-migración | Δ |
|---|---|---|---|
| `"arbol"` (irrelevante) | 54.3% | **54.1%** | −0.2 pp — el ruido **no subió** ✅ |
| `"qué es Credimisión"` | 77.3% · pos 1 | **79.5%** · pos 1 | +2.2 pp |
| `"que garantia tienen las heladeras?"` | 75.8% · **pos 2** | **78.4%** · **pos 1** | +2.6 pp y gana el ranking |
| `"qué sabes sobre la empresa?"` | **fuera del top-4** | **62.1%** · **pos 1** | de invisible a primero |

**Veredicto del arnés**: ruido 54.1% · umbral 65.0% · señal 78.4% → **el umbral separa
los dos grupos**. El valor de 0.65 no se tocó (FR-015) y queda respaldado por medición.

Salidas completas en [`linea-base.txt`](./linea-base.txt) y
[`medicion-post.txt`](./medicion-post.txt).

> **`"qué sabes sobre la empresa?"` sigue sin cruzar el umbral, y está bien.** Pasó de
> no aparecer siquiera en el top-4 a ser el primer resultado — el título arregló el
> **orden**, no el veredicto. Su causa es que «Sobre Nosotros» y «Qué es Credimisión»
> se reparten la señal, y eso lo atacan las pre-specs 2 y 3 del Sprint 5B. La consulta
> queda en el conjunto de control marcada `debeFallar` para que el día que pase, se note.

### Registro de la validación manual

| Fecha | Qué se probó | Resultado |
|---|---|---|
| 2026-08-22 | Suite completa (`npm test`) | 633/633 ✅, incluidos 11 tests nuevos. `knowledge-search-filter.spec.ts` pasa **sin modificarse** → el filtro de audiencia no se movió (FR-007) |
| 2026-08-22 | Guarda de integridad, con embeddings mockeados devolviendo `[]` | Aborta antes de escribir en Chroma; en `reindex()` **no** llega a borrar los fragmentos viejos; el documento nunca queda `SYNCED` |
| 2026-08-22 | Migración de los 78 documentos, `--intervalo 2000` | 78/78 `SYNCED`, cero `REINDEX_FAILED`, cero vectores vacíos en los logs |
| 2026-08-22 | Límite de la API, confirmado en la consola de Google | **100 RPM** para Gemini Embedding 2 en nivel gratuito. El corpus son ~101 fragmentos: a 2 s por documento el ritmo efectivo es ~39 RPM. A 500 ms habría dado ~150 RPM y lo habría reventado |
| 2026-08-22 | Auditoría del umbral (FR-012) | Cuatro consumidores. Tres ya leían de configuración; `supervisor.service.ts:322` tenía un default `0.65` en código — corregido |
