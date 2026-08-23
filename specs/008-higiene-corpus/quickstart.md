# Quickstart — verificar la spec 008

Cómo comprobar a mano que las tres historias funcionan.

## Prerrequisitos

```bash
docker compose up -d
docker compose exec nestjs npx prisma db push   # esta spec SÍ cambia el esquema
curl http://localhost:3000/health
```

Token de supervisor:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"diego.bazan@credimision.com","password":"trimia2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
```

> **Diego es responsable de las cinco áreas.** Sirve para el camino feliz, pero **no
> para probar FR-011**: con él nunca va a aparecer una pareja que no pueda fusionar.
> Para eso está **Silvia Ríos** (`silvia.rios@credimision.com`, solo Cobranzas), que ya
> quedó en la lista de usuarios de prueba del panel. La spec 007 se probó con ella y
> fue lo que hizo visible el rechazo por área de verdad.

---

## 0. Calibrar el umbral — antes que nada

```bash
docker compose exec nestjs npx ts-node scripts/calibrar-fusion.ts
```

**No se hereda el 0.75 de la spec 007.** Medido sobre este mismo corpus, ese valor
marca **141 de 343** parejas elegibles — el 41%. Una lista así no se revisa: se aprueba
a ciegas, que es el riesgo principal declarado de la pre-spec.

Lo que el arnés tiene que mostrar:

| umbral | parejas | veredicto |
|---|---|---|
| 0.75 | ~141 | inservible |
| 0.80 | ~48 | todavía mucho |
| **0.85** | **~13** | revisable |
| 0.90 | ~2 | demasiado estricto |

El valor elegido va a `.env` como `KNOWLEDGE_MERGE_THRESHOLD`. **Guardar la salida**:
es lo que respalda SC-006.

---

## 1. Detectar y fusionar (US1) — el corazón de la spec

### Lanzar el barrido

```bash
SCAN=$(curl -s -X POST http://localhost:3000/knowledge/hygiene/scan \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['scanId'])")
echo $SCAN
```

Responde en milisegundos con `RUNNING`. Si tarda, está mal: el barrido no puede correr
dentro del request (Principio IV).

Un segundo `POST` mientras corre tiene que dar **409** — dos barridos simultáneos
gastan el doble de tokens para lo mismo.

### Esperar y mirar el resultado

```bash
sleep 70
curl -s http://localhost:3000/knowledge/hygiene/scan/latest \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Lo que tiene que pasar** (SC-006, SC-007):

- `status: "READY"`, `documentsScanned: 78`
- **del orden de 10-15 parejas**, nunca 140
- entre las primeras, los documentos basura del E2E del Sprint 5A:
  «E2E reintegros (editado)» contra sí mismo (mismo título, dos filas) y
  «E2E verificacion» ↔ «Subido desde el cliente del panel». Son duplicados conocidos y
  verificables a ojo: **la comprobación más barata de que la detección anda**
- `escalatedTurns: 0` en casi todas. **Es lo esperado**, no un error: la base tiene 2
  turnos escalados en total

### La verificación de confidencialidad (SC-002)

Ninguna pareja puede cruzar área ni audiencia:

```bash
curl -s http://localhost:3000/knowledge/hygiene/scan/latest -H "Authorization: Bearer $TOKEN" \
 | python3 -c "
import sys,json
p=json.load(sys.stdin)['pairs']
malas=[x for x in p if x['documentA']['audience']!=x['documentB']['audience']
       or x['documentA']['agentType']!=x['documentB']['agentType']]
print('parejas:',len(p),'| que cruzan área o audiencia:',len(malas))
assert not malas, malas
print('✅ ninguna cruza')"
```

**Cero excepciones.** Una fusión entre audiencias metería contenido `INTERNO` en un
documento que lee un cliente: sería una fuga con firma humana (Principio I).

### Fusionar

```bash
PAIR=<pairId de la lista>
KEEP=<id del documento que sobrevive>

# Propuesta — NO guarda nada
curl -s -X POST http://localhost:3000/knowledge/hygiene/pairs/$PAIR/merge-preview \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"keepDocumentId\":\"$KEEP\"}" | python3 -m json.tool
```

Verificar que **no se guardó nada**: la `version` del documento no cambió.

```bash
# Aprobar, mandando el texto (que puede venir editado a mano)
curl -s -X POST http://localhost:3000/knowledge/hygiene/pairs/$PAIR/merge-apply \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d "{\"keepDocumentId\":\"$KEEP\",\"baseVersion\":N,\"content\":\"...\"}"
```

Después (SC-005):

```sql
-- Uno sube de versión, el otro se DESACTIVA. Ninguno se borra.
SELECT id, title, version, "isActive" FROM "KnowledgeDocument" WHERE id IN ('...','...');

-- El total no cambia
SELECT count(*) FROM "KnowledgeDocument";

-- La bitácora dice de dónde vino el contenido (FR-016)
SELECT "changedFields", origin, "mergedFromDocumentId" FROM "KnowledgeChange"
WHERE "documentId" = '<keep>' ORDER BY "createdAt" DESC LIMIT 1;
```

### **La verificación que importa (SC-003)**

Buscar algo que antes recuperaba a los dos documentos. Tiene que recuperar **uno solo**,
con la información combinada y **sin perder score**. Ése es el resultado que la feature
persigue: no fusionar por prolijidad, sino que dejen de repartirse la señal.

### FR-011 — el área ajena

Con **Silvia** (solo Cobranzas), pedir el resultado del barrido: las parejas de otras
áreas tienen que **aparecer igual** (ver no es editar) pero con `fusionable: false` y
el motivo. `merge-preview` sobre una de ésas → **403, sin llamar a Gemini**.

---

## 2. Descartar (US2)

```bash
curl -s -X POST http://localhost:3000/knowledge/hygiene/pairs/$PAIR/discard \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"reason":"Uno es la política general y el otro el caso puntual."}'
```

Volver a correr el barrido: **esa pareja no vuelve** (SC-004).

Y la contracara (FR-014): editar uno de los dos documentos, correr el barrido otra vez
→ **la pareja vuelve a aparecer**. Lo que se descartó fue ese contenido, no esos dos
ids para siempre.

```sql
SELECT "versionA", "versionB", reason FROM "KnowledgeMergeDiscard";
-- comparar contra las versiones vigentes de los documentos
```

---

## 3. Aviso dentro de un caso (US3)

Resolver un caso escalado cuyos documentos consultados formen una pareja detectada:

```bash
curl -s "http://localhost:3000/supervisor/escalations/$CASO/hygiene-warning" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Tiene que traer la pareja, apuntando **a la misma fusión de la US1** (no a un mecanismo
propio). Un caso cuyos documentos no compiten devuelve `pairs: []`.

Si nunca se corrió un barrido, devuelve vacío — no dispara una detección al vuelo.

---

## 4. Que nada se rompa

- **Barrido interrumpido**: cortar el servicio a mitad de camino. La corrida tiene que
  quedar `FAILED` con motivo, **no** `READY` con la mitad de las parejas. Una corrida a
  medias presentada como completa le diría al supervisor "tu corpus está limpio".
- **Fusión con el documento ya desactivado por otra fusión**: `merge-preview` → 404, no
  una propuesta contra un documento fantasma.
- **Conflicto de versión**: editar el documento entre el preview y el apply → **409
  `VERSION_CONFLICT`**, igual que en la edición con IA.

---

## Registro de la validación manual

| Fecha | Qué se probó | Resultado |
|---|---|---|
| 2026-08-23 | Barrido completo contra el corpus real (Diego) | `documentsScanned: 78`, `pairsFound: 10`, `threshold: 85` — igual a lo calibrado en `calibracion-fusion.txt`. Un segundo `POST /scan` mientras corría dio **409 SCAN_ALREADY_RUNNING** |
| 2026-08-23 | SC-007: duplicados conocidos en la banda alta | «E2E verificacion» ↔ «Subido desde el cliente del panel» en 94.7%, y «E2E reintegros (editado)» contra sí mismo en 88.3% — los dos primeros/entre los primeros de la lista |
| 2026-08-23 | SC-002: cero cruces de área o audiencia | Script de `quickstart.md` sobre las 10 parejas reales: `0` cruces |
| 2026-08-23 | Fusión de «E2E reintegros (editado)» (US1) | `merge-preview` dio `confident:false` (documentos idénticos, correcto); `merge-apply` con el mismo contenido → `newVersion` **no subió** la primera vez — bug real encontrado y corregido en `knowledge.service.ts` (`update()` no escribía `KnowledgeChange` cuando el contenido no cambiaba, aunque fuera una fusión). Cubierto con test de regresión en `knowledge-crud.spec.ts` |
| 2026-08-23 | SC-005: conteo de documentos | 78 antes y después de la fusión — el absorbido queda `isActive:false`, ninguno se borra |
| 2026-08-23 | SC-003 | Búsqueda "plazo de reintegro" antes de la fusión hubiera devuelto los dos; después devuelve «E2E reintegros (editado)» **una sola vez** |
| 2026-08-23 | US2: descartar y volver a correr | Pareja «Promoción cuota 12» ↔ «Beneficio buen pagador» descartada; el barrido siguiente (77 docs tras la fusión) dio 8 parejas — ni la descartada ni la ya fusionada reaparecieron |
| 2026-08-23 | FR-011 con Silvia (Ventas, no todas las áreas) | Parejas de otras áreas listadas con `fusionable:false` y motivo; `merge-preview` sobre una de ésas → **403 sin latencia de modelo** |
| 2026-08-23 | Documento ya desactivado | `merge-preview` sobre la pareja ya fusionada → **404** |
| 2026-08-23 | Conflicto de versión | `merge-apply` con `baseVersion` vieja → **409 VERSION_CONFLICT**, con la versión vigente en el mensaje |
| 2026-08-23 | US3: aviso reactivo | `GET .../hygiene-warning` sobre las dos escalaciones reales de la base → `pairs: []` en las dos (sus documentos no forman parejas detectadas). El caso "SÍ hay pareja" se cubre con tests (no hay overlap real en el corpus de desarrollo) |
