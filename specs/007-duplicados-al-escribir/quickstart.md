# Quickstart — verificar la spec 007

Cómo comprobar a mano que las cuatro historias funcionan.

## Prerrequisitos

```bash
docker compose up -d
docker compose exec nestjs npx prisma db push   # esta spec SÍ cambia el esquema
curl http://localhost:3000/health
```

Token de supervisor para los `curl`:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"diego.bazan@credimision.com","password":"trimia2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
```

> **Diego es responsable de las cinco áreas** (es gerente por la regla de la spec 005).
> Sirve para el camino feliz, pero **no para probar FR-006**: con él nunca va a aparecer
> un documento que no pueda corregir. Para eso hace falta Laura (Ventas) o similar.

---

## 0. Calibrar el umbral — antes de probar US3

```bash
docker compose exec nestjs npx ts-node scripts/calibrar-parecido.ts
```

Sobre pares del corpus real con relevancia conocida. Los que deberían dar **alto**:
«Sobre Nosotros» ↔ «Qué es Credimisión» (el duplicado real del 2026-08-20) y «Garantia
extendida» ↔ «Devoluciones, cambios y garantía». Los que deberían dar **bajo**: «Envíos»
↔ «Monto mínimo de compra» — mismo dominio, temas distintos.

El valor elegido va a `.env` como `KNOWLEDGE_SIMILARITY_THRESHOLD`. **Guardar la salida**:
es lo que respalda SC-008.

> **No heredar el 0.65 del RAG.** Compara otra cosa y la distribución es más alta:
> avisaría casi siempre.

---

## 1. Corregir en vez de duplicar (US1) — el corazón de la spec

### Provocar el escalado

En el panel → **Chat con el Asistente**, preguntar algo que el corpus cubra **a medias**.
El caso conocido:

```text
qué sabes sobre la empresa?
```

Medido en la spec 006: el documento correcto queda primero pero en **62.1%**, bajo el
umbral de 65%. Escala.

### Ver qué quedó corto

```bash
curl -s "http://localhost:3000/supervisor/escalations/$CASO/knowledge-candidates" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Tiene que traer «Qué es Credimisión» y «Sobre Nosotros» con sus scores, ordenados, **una
entrada por documento** (no una por fragmento).

### Corregir y verificar el resultado

En el panel → **Casos Escalados** → responder eligiendo **corregir** «Sobre Nosotros» en
vez de crear uno nuevo. Revisar la propuesta, editarla si hace falta, aprobar.

Después:

```sql
-- Tiene que haber UN documento con la versión incrementada, y NINGUNO nuevo.
SELECT title, version, "updatedAt" FROM "KnowledgeDocument"
WHERE title ILIKE '%sobre nosotros%';

SELECT count(*) FROM "KnowledgeDocument" WHERE "createdAt" > now() - interval '5 minutes';
-- esperado: 0
```

### **La verificación que importa (SC-002)**

Volver al chat y **repetir la misma consulta**. Tiene que **contestar**, no escalar.

Ése es el resultado que la feature persigue: no evitar un duplicado, sino que el
escalado deje de repetirse.

### FR-006 — el área ajena

Con un supervisor de **una sola** área (Laura, Ventas), abrir un caso cuyo documento
cercano sea de otra área. El documento tiene que **aparecer en la lista** —ver no es
editar— pero **marcado como no corregible y con el motivo**. Pedir su propuesta se
rechaza.

---

## 2. Duplicado exacto (US2)

```bash
BODY='{"title":"Prueba dup","content":"Texto exactamente igual.","category":"prueba","audience":"PUBLICO"}'

# Primera vez: 201
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/knowledge \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "$BODY"

# Segunda: 409, y la respuesta dice CUÁL es el previo
curl -s -X POST http://localhost:3000/knowledge \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d "$BODY" \
  | python3 -m json.tool
```

Insistiendo explícitamente, se crea igual — **detección, no prohibición**.

**FR-013**: durante el 409 no puede haber ninguna llamada de embeddings. Se ve en los
logs, y es lo que evita gastar cuota en lo que ya está.

---

## 3. Parecido al cargar (US3)

Cargar un documento sobre un tema **ya cubierto** (por ejemplo, otro sobre garantías): la
respuesta tiene que traer los parecidos con título y score, **y el documento se crea
igual**.

Cargar uno sobre un tema **nuevo** (una política que no existe): **sin avisos**. Si acá
aparece algo, el umbral está mal calibrado — volver al paso 0.

---

## 4. Caminos automáticos (US4)

Subir un archivo cuyo texto extraído sea idéntico a un documento existente. Tiene que:

- **no** crear un segundo documento,
- **no** fallar el procesamiento,
- dejar el archivo apuntando al documento que ya existía.

Y resolver un caso enseñándole a la IA con un texto idéntico a uno ya cargado:

```sql
SELECT "resolvedWithAction", "resolvedWithDocumentId" FROM "Escalation" WHERE id = '…';
-- esperado: REUSED + el id del documento que ya estaba
```

---

## 5. Que nada se rompa (FR-024, FR-025)

Con el servicio de embeddings caído —una clave inválida temporal alcanza—, cargar un
documento **tiene que terminar bien**, sin aviso de parecidos. Guardar el conocimiento es
lo importante; opinar sobre parecidos es lo accesorio.

---

## Registro de la validación manual

| Fecha | Qué se probó | Resultado |
|---|---|---|
| 2026-08-23 | Suite completa (`npm test`) | 682/682 ✅. `knowledge-search-filter.spec.ts` sin cambios: el filtro de audiencia no se movió |
| 2026-08-23 | US1 — caso real: *"qué sabes sobre la empresa?"* (el mismo de la spec 006, 62.1%) → `knowledge-candidates` devolvió «Qué es Credimisión» primero → `correction-preview` propuso una sección nueva (`confident: true`) → `resolve` con `correctKnowledge` | Caso `RESOLVED` + `CORRECTED`, apuntando al documento. **78 documentos antes, 78 después.** Versión `1→2`, `SYNCED`. `KnowledgeChange.escalationId` = el caso (FR-009) |
| 2026-08-23 | US1 — salvaguarda `confident: false` | Primer intento pidió agregar algo que el documento **ya decía**: el modelo se negó, sin gastar una edición redundante. Reutilización real de `ai-edit`, no solo en el papel |
| 2026-08-23 | **FR-006 con Silvia Ríos** (supervisora de una sola área, no Diego) sobre un caso con candidatos de Ventas y uno transversal | Los tres candidatos **se listan** (ver no es editar) pero **ninguno corregible**, con el motivo correcto en cada uno (`"Sos responsable de: Cobranzas"`, `"responde para todos los agentes... quien es responsable de todas"`). `correction-preview` sobre uno ajeno → **403**, sin llamar a Gemini |
| 2026-08-23 | US2 — duplicado exacto real: cargar el mismo `content` dos veces | 201 → **409** `DUPLICATE_DOCUMENT` con el previo identificado. Con `force: true`, 201 y **2** documentos con ese título — detección, no prohibición |
| 2026-08-23 | US3 — cargar un texto sobre envíos parecido a «Envíos» del corpus | `similarDocuments` con **84.4%** de score (por encima del umbral calibrado de 75%), `audienciaDistinta: false`, y **el documento se creó igual** — el aviso no bloqueó nada |
| 2026-08-23 | US4 — duplicado exacto en archivo subido y en `saveUnsent`/`teachAgent` | Cubierto por test (no por API real, para no depender de un archivo binario de prueba): ningún camino crea un segundo documento, ninguno falla la operación, `REUSED` queda registrado |
