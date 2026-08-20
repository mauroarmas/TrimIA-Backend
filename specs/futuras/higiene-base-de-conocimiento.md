# Higiene de la base de conocimiento — insumo para una spec futura

**Detectado**: 2026-08-20, probando el panel después de cerrar la spec 005.
**Estado**: anotado, **sin implementar**. No hay rama ni tareas.

> Esto **no es una spec**: es el registro de un problema real, con la evidencia que
> lo hizo visible y las decisiones difíciles ya identificadas, para que quien escriba
> la spec no arranque de cero. Sigue el mismo criterio que
> [docs/hallazgos-para-proxima-spec.md](../../docs/hallazgos-para-proxima-spec.md),
> que fue el insumo de la 005.

---

## El problema, en una frase

El sistema **detecta** que dos documentos se están compitiendo y hasta te lo dice,
pero **no te da con qué encontrarlos ni con qué arreglarlo** — y además fabrica
duplicados nuevos por diseño.

## La evidencia

Diego preguntó *"qué sabés sobre la empresa?"* y no obtuvo respuesta: el mejor
documento quedó en 62.6%, contra un umbral de 65%. Había cargado un documento
«Sobre Nosotros» justo para eso.

El documento estaba perfecto —`GENERAL`, `PUBLICO`, activo, `SYNCED`— y **sí se
recupera**. Lo que pasaba era otra cosa:

```text
consulta                        resultado
"qué es Credimisión"            «Qué es Credimisión…» 77%  ·  «Sobre Nosotros» 71%
"qué sabes sobre la empresa?"   ninguno de los dos entra en el top-6; el mejor: 62%
```

Dos documentos cubriendo el mismo tema, cargados con 19 minutos de diferencia. Se
reparten la señal y ninguno gana. **Es exactamente el caso que el aviso de baja
confianza de la spec 005 describe** —"dos documentos parecidos se compiten entre sí
y las respuestas salen peor"— y no hay nada que ayude a encontrarlos.

## Por qué importa más de lo que parece

- **Degrada las respuestas para todos, no para quien duplicó.** Un duplicado no
  rompe nada visible: baja un score dos puntos y el turno escala. Nadie lo asocia
  con el documento que cargó otra persona hace tres semanas.
- **El sistema fabrica duplicados por diseño.** Resolver un caso con "enseñarle al
  agente" **siempre crea un documento nuevo**, nunca actualiza uno existente
  ([escalations.service.ts](../../src/escalations/escalations.service.ts), `resolve`
  y `saveUnsent` → `knowledge.ingest`). Cada caso parecido resuelto dos veces deja
  dos documentos parecidos. Es la causa de arriba, y va a ganarle a cualquier
  limpieza periódica si no se ataca también.
- **Ni siquiera se detectan los duplicados exactos.**
  `KnowledgeDocument.checksum` se calcula y se guarda
  ([knowledge.service.ts:291](../../src/ai/knowledge/knowledge.service.ts#L291))
  y **nunca se lee**: no hay índice, no hay unique, nadie lo consulta. El mismo
  texto ingestado dos veces por caminos distintos entra dos veces sin una palabra.
  (En archivos sí hay deduplicación, pero por hash del **binario**, no del
  contenido: `assertNotDuplicate` en
  [knowledge-ingestion.service.ts:218](../../src/ai/knowledge/knowledge-ingestion.service.ts#L218).)

---

## Qué se pidió

Dos disparadores, no uno:

| Cuándo | Dónde | Qué hace |
|---|---|---|
| **Reactivo** | En el aviso de baja confianza, cuando los documentos consultados se parecen entre sí | Ofrece fusionarlos ahí mismo, en el momento en que el problema se hizo visible |
| **Proactivo** | Botón "Limpiar base de conocimiento" en la pantalla de conocimiento | Recorre el corpus y **propone** fusiones y bajas: duplicados, solapamientos, contradicciones |

En los dos casos el resultado es una **propuesta**, y la fusión la redacta la IA.

---

## Lo que ya existe y hay que reusar, no construir

| Qué | Dónde | Para qué sirve acá |
|---|---|---|
| Edición asistida con aprobación explícita | `knowledge-ai-edit.service.ts` (`preview` / `apply`) | **El patrón ya está resuelto**: `preview` no persiste nada y `apply` guarda el texto que la persona confirmó, con `baseVersion` para el conflicto. Una fusión es eso mismo con dos documentos de entrada |
| Telemetría de recuperación | `KnowledgeRetrieval` (documento, conversación, score, rank, outcome) | Sabe **qué documentos salieron juntos en el mismo turno y si el turno se resolvió**. Es la señal más fuerte que hay, ver abajo |
| Métricas por documento | `knowledge-usage.service.ts` (`forDocuments`) | "Apareció N veces, sirvió M" ya calculado y por lote |
| Bitácora de cambios | `KnowledgeChange` | Una fusión tiene que quedar registrada como cualquier edición (OE-11) |
| Regla de escritura por área | `KnowledgeService.assertPuedeEscribir` (spec 005) | Fusionar **es escribir**: pasa por acá, y trae la pregunta difícil de más abajo |
| Búsqueda con score | `knowledge.search()` | Encontrar los parecidos de un texto dado sin construir nada nuevo |

---

## Las decisiones difíciles (lo que hay que resolver antes de codear)

**1. Parecido NO es duplicado, y confundirlos rompe la confidencialidad.**
Dos documentos del mismo tema con **audiencia distinta** (`PUBLICO` e `INTERNO`) son
legítimos y frecuentes: uno es lo que se le dice al cliente y el otro lo que sabe el
empleado. Fusionarlos filtraría conocimiento interno a clientes — Principio I, la
regla que no se negocia. Lo mismo con dos áreas: el procedimiento de Ventas y el de
Cobranzas sobre el mismo trámite pueden parecerse mucho y no ser lo mismo.
**La detección tiene que separar "parecidos" de "fusionables" antes de proponer nada.**

**2. La señal fuerte no es la similitud: es el comportamiento.**
Comparar vectores encuentra parejas parecidas, incluidas las legítimas del punto 1.
`KnowledgeRetrieval` ya registra algo mejor: **qué documentos aparecen juntos, turno
tras turno, en consultas que terminan escalando**. Dos documentos que siempre salen
juntos y nunca resuelven se están compitiendo — eso es evidencia medida, no una
conjetura de coseno. Vale evaluar arrancar por ahí.

**3. ¿Quién puede fusionar dos documentos de áreas distintas?**
Fusionar es escribir en los dos. Con la regla de la spec 005, hace falta ser
responsable de **ambas** áreas; si no, no se puede — y el resultado, ¿en qué área
queda? Un documento transversal solo lo toca quien es responsable de todas. Hay tres
salidas posibles (rechazar, pedir a quien corresponda, o derivar como en US4) y hay
que elegir una a propósito.

**4. Borrar es irreversible.**
`remove()` borra de Chroma y de Postgres. Una limpieza que borre necesita la misma
aprobación explícita que `ai-edit/apply` — **nunca automática** (Principio III). Y
conviene decidir si "eliminar" no debería ser en realidad "desactivar", que ya
existe, no pierde los vectores y se revierte.

**5. Documento vs. chunk.**
Chroma guarda vectores por **chunk**, no por documento: comparar documentos exige
decidir cómo (promedio de chunks, máximo par a par, un embedding del texto entero) y
cada opción tiene un costo distinto en llamadas a Gemini. Nota aparte: hoy un
documento largo puede ocupar **varios lugares del top-k** y desperdiciar el
presupuesto de contexto — se vio el 2026-08-20, un mismo documento ocupando 2 de 4
lugares. Es un problema **distinto** de la duplicación entre documentos, pero se
descubre en el mismo lugar y conviene tenerlo a la vista.

**6. Costo.** Recorrer el corpus comparando todo contra todo es cuadrático. Con 60
documentos no se nota; hay que decidir si eso alcanza o si el botón trabaja por lote,
en segundo plano y con un tope.

---

## Lo que NO debe hacer

- **Fusionar o borrar solo.** Propone; decide una persona. Un corpus que se edita
  a sí mismo sin aprobación es la peor versión de esta feature.
- **Tocar documentos de áreas ajenas**, ni siquiera "para limpiar".
- **Fusionar entre audiencias distintas** sin una decisión explícita de producto.
- **Presentar el resultado como un error.** Es un informe para decidir, igual que
  el aviso de baja confianza.

---

## Esto es tanto frontend como backend, y ahí hay una tensión con la convención

En las specs anteriores el panel **exhibía** lo implementado: el rigor iba del lado
del backend y `trimIA-frontend` era un banco de pruebas para poder ejercitar los
endpoints. **Acá no.** La decisión de fusionar dos documentos es un acto de
comparación: hay que ver qué dice cada uno, qué aporta cada uno, qué se pierde si
uno desaparece. Eso no se decide leyendo una respuesta JSON.

**Una propuesta de fusión que no se puede leer comparativamente no se puede aprobar
con criterio: se aprueba a ciegas.** Y ahí la aprobación humana del Principio III
deja de ser una garantía y pasa a ser un trámite — que es peor que no tener la
feature, porque el corpus se degrada *con* firma.

Lo que la interfaz necesita, como mínimo:

- **Los dos documentos lado a lado**, con lo que cada uno aporta y lo que se solapa
  marcado. `KnowledgeDetail` ya tiene la semilla: el editor con IA muestra
  `changedSections` en una tabla antes/después.
- **La propuesta fusionada editable antes de aprobar**, como ya hace `ai-edit/apply`
  —guarda el texto del body, que puede venir corregido a mano, nunca uno
  regenerado—. Ese contrato hay que conservarlo.
- **Poder decir "no, son distintos a propósito"** y que el sistema lo recuerde. Sin
  eso, el botón vuelve a proponer la misma pareja cada vez y en dos semanas nadie lo
  abre. Un descarte que no se persiste convierte a la herramienta en ruido.
- **Una lista priorizada, no un volcado.** Con 60 documentos las parejas candidatas
  pueden ser decenas; sin un orden por impacto —cuántos turnos se están perdiendo
  por cada pareja, dato que `KnowledgeRetrieval` ya tiene— es una lista que se mira
  una vez.

**La decisión a tomar**: esta pantalla no encaja en "banco de pruebas, sin exigencia
de calidad" (constitución, *Cierre de una spec*). O se le sube la vara a esta
pantalla en particular y se dice por qué, o se asume que la feature va a quedar
demostrable pero no usable. Conviene decidirlo **al escribir la spec**, no al final:
cambia la estimación y cambia dónde está el riesgo del proyecto.

---

## Un arreglo chico que se puede hacer antes, y aparte

Sin esperar a esta feature: **avisar al momento de escribir**, no después.

Cuando alguien carga un documento —o resuelve un caso enseñándole al agente—, correr
`knowledge.search()` con el contenido nuevo y, si aparece algo por encima de cierta
similitud, mostrarlo: *"ya hay un documento parecido: ¿querés corregir ese en vez de
crear uno nuevo?"*. No impide nada, solo lo pone a la vista.

Es mucho más barato que la limpieza, ataca la **causa** en vez del síntoma, y usa
piezas que ya están. Si se hace esto primero, la limpieza queda para el corpus que ya
está sucio en vez de para uno que se ensucia solo.

Igual de barato: **leer el `checksum` que ya se guarda**, para cortar los duplicados
exactos antes de gastar embeddings.

---

## Preguntas abiertas

- ¿"Limpiar" incluye **contradicciones** (dos documentos que dicen cosas distintas
  del mismo tema) o solo solapamientos? Detectar contradicciones es un problema
  bastante más duro que detectar parecidos, y probablemente merezca su propia etapa.
- ¿La fusión conserva las dos trazas de origen (`sourceType`/`sourceId`) o se queda
  con una? Afecta la trazabilidad del Sprint 5A.
- ¿Qué pasa con las métricas de uso de los documentos fusionados? Sumarlas miente;
  perderlas también.
- El descarte de una pareja ("son distintos a propósito"), ¿es para siempre o vence?
  Dos documentos legítimamente distintos hoy pueden converger cuando alguien edita
  uno de los dos.
