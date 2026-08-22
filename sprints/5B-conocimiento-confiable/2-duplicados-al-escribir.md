# Pre-spec 2 — Duplicados al escribir

**Sprint** 5B · **Orden** 2 de 5 · **Tareas del plan** 5B.4–5B.5
**Depende de** pre-spec 1 (los scores cambian con los embeddings nuevos) · **Estado** sin spec · **Spec** —
**Origen** futura del 2026-08-20 (`higiene-base-de-conocimiento.md`), sección "un arreglo chico"

## Qué se quiere

Que el sistema avise **en el momento de cargar** cuando ya hay un documento parecido,
en vez de descubrirlo semanas después porque las respuestas empeoraron.

Es chica y va antes que la pre-spec 3 a propósito: **ataca la causa, la 3 ataca el
síntoma**. Si se hace primero, la higiene del corpus queda para lo que ya está sucio
en vez de para algo que se sigue ensuciando solo.

## Alcance

- **Entra:** leer el `checksum` que ya se calcula, para cortar duplicados exactos
  antes de gastar embeddings; y correr `search()` con el contenido nuevo al ingestar,
  mostrando lo parecido que aparezca.
- **Entra:** los **tres** caminos de ingesta — documento cargado a mano, escalado
  resuelto con "enseñarle a la IA", y entrevista (pre-spec 5).
- **No entra:** fusionar, borrar ni proponer nada sobre el corpus que ya existe —eso
  es la pre-spec 3—. Acá solo se avisa; **no se impide nada**.

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| `checksum` calculado y guardado | [`knowledge.service.ts:291`](../../src/ai/knowledge/knowledge.service.ts#L291) | **Se persiste y nunca se lee**: no hay índice, ni unique, ni consulta. Duplicado exacto = comparación gratis |
| Deduplicación de archivos | `assertNotDuplicate` en [`knowledge-ingestion.service.ts:218`](../../src/ai/knowledge/knowledge-ingestion.service.ts#L218) | Ya existe el patrón, pero por hash del **binario**, no del contenido. Sirve de molde |
| Búsqueda con score | `knowledge.search()` | Encontrar parecidos sin construir nada nuevo |
| Ingesta desde escalado | `resolve` y `saveUnsent` → `knowledge.ingest` en [`escalations.service.ts`](../../src/escalations/escalations.service.ts) | El camino que **fabrica duplicados por diseño**: resolver siempre crea documento nuevo, nunca actualiza |

## Decisiones al especificar

1. **A partir de qué similitud se avisa.** Con el piso de ruido en ~0.53 (y moviéndose
   por la pre-spec 1), un corte mal puesto avisa siempre o no avisa nunca.
2. **Qué se hace con el aviso.** ¿Solo se muestra, o se ofrece "corregir aquel en vez
   de crear este"? Lo segundo es mucho más valioso y bastante más caro.
3. **El aviso en la ingesta automática.** En "responder y enseñar a la IA" hay una
   persona para leerlo; hay que ver si en todos los caminos la hay.
4. **Duplicado exacto: ¿se bloquea o se avisa?** Es el único caso donde bloquear no
   tiene falsos positivos.

## Riesgo principal

Un aviso que aparece siempre se vuelve invisible en una semana y deja el problema
igual, pero con una molestia extra encima.

---

## Material de respaldo

### La evidencia (2026-08-20)

Diego preguntó *"qué sabés sobre la empresa?"* y no obtuvo respuesta: el mejor
documento quedó en **62.6%** contra un umbral de 65%. Había cargado un documento
«Sobre Nosotros» justo para eso, y el documento estaba perfecto —`GENERAL`, `PUBLICO`,
activo, `SYNCED`— y sí se recuperaba.

```text
consulta                        resultado
"qué es Credimisión"            «Qué es Credimisión…» 77%  ·  «Sobre Nosotros» 71%
"qué sabes sobre la empresa?"   ninguno de los dos entra en el top-6; el mejor: 62%
```

**Dos documentos del mismo tema, cargados con 19 minutos de diferencia.** Se reparten
la señal y ninguno gana.

### Por qué el sistema los fabrica solo

Resolver un caso con "enseñarle al agente" **siempre crea un documento nuevo**, nunca
actualiza uno existente. Cada caso parecido resuelto dos veces deja dos documentos
parecidos. Es la causa de lo de arriba, y le va a ganar a cualquier limpieza periódica
si no se ataca también.

Y los duplicados **exactos** tampoco se detectan: el mismo texto ingestado dos veces
por caminos distintos entra dos veces sin una palabra, porque el `checksum` que
existiría para eso no se lee nunca.
