# Fase 0 — Entrevista desde el tráfico real

**Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

Todo lo de acá está medido contra la base de desarrollo el 2026-08-24, no razonado en el
aire. Tres de los seis hallazgos cambiaron requisitos de la spec.

## El estado real del que parte la feature

```sql
-- turnos ruteados, por agente
SELECT "agentType", COUNT(*), SUM(CASE WHEN (payload->>'escalated')::bool THEN 1 ELSE 0 END)
FROM "OrchestrationEvent" WHERE "eventType"='ROUTED_TO_AGENT' GROUP BY 1;
```

| Señal | Medido | Qué implica |
|---|---|---|
| Turnos ruteados | **12, todos `SALES`** | Cuatro de las cinco áreas están en cero |
| Corrida de cobertura | READY, 12 consultas, **1 tema**, 4 sueltas | El camino principal funciona, pero solo para Ventas |
| Ese tema | `AL_LIMITE`, **`cause = NULL`**, 4 consultas | Ver D1 |
| Escalados `RESOLVED` | 2, **las dos ya capitalizadas** (`CORRECTED`) | Ver D3 |
| Escalados `PENDING` | 1 | Ver D2 |
| Parejas de higiene | 24, de 4 barridos | Ver D2 |
| Documentos activos | 69 `DOCUMENTO` + 4 `ESCALADO` | El corpus está poblado; el hueco no es de volumen |
| Sectores con responsable | 5 de 5 (Ventas tiene 2) | La autorización por área tiene con qué probarse |

---

## D1 — La banda "al límite" no tenía rama, y es lo único que hay

**Lo que se creía**: cada tema del resumen de cobertura trae una causa, y la pregunta se
elige por ella — *no existe documento* pide contenido nuevo, *quedó corto* pide corrección.

**Lo medido**: el único tema de la base es `AL_LIMITE` con `cause = NULL`. No es un dato
faltante: en la spec 009 **banda y causa son ejes ortogonales**, y la banda "al límite"
—se contestó, pero raspando por encima del umbral— se clasifica por banda y no lleva causa.

**Decisión**: `AL_LIMITE` va por la rama de corrección. Se contestó, o sea que hay documento
detrás; la pregunta muestra ese documento y pide qué le falta.

**Por qué**: es lo que hace SC-001 verdadero sin excepciones. Mandarlo por la rama de
"cargar" propondría crear un documento nuevo sobre un tema que ya tiene uno respondiendo
—apenas, pero respondiendo—, que es exactamente el duplicado que esta feature no puede
fabricar.

**Alternativa descartada**: no preguntar sobre temas al límite. Dejaría la feature sin nada
que preguntar en el estado actual, y "casi no llega" es justo donde una frase agregada al
documento correcto rinde más.

---

## D2 — El respaldo por parejas de higiene se contradecía con FR-008

**Lo que se creía**: con 24 parejas de higiene abiertas, son buena materia prima para
preguntar cuando el área no tiene temas de cobertura.

**El problema**: FR-008 excluye de las preguntas los temas donde dos documentos compiten,
con el argumento de que preguntar ahí agrega un tercero al conflicto. Una pareja de higiene
**es** ese caso. La misma spec proponía como respaldo lo que excluía como fuente principal.

**Decisión**: se cae la pierna de higiene (FR-013d) y la reemplazan los escalados
**pendientes** (FR-013c) — consultas reales que el agente no supo contestar y que ningún
humano contestó todavía.

**Por qué el reemplazo es mejor material**: un escalado pendiente es conocimiento faltante
en estado puro. No hay documento que corregir ni parecido que evitar: nadie lo contestó. Es
la única forma de pregunta donde el sistema no tiene texto que proponer, y por eso mismo la
que menos riesgo de duplicado trae.

**Alternativa descartada**: dejar higiene con una pregunta de desambiguación ("estos dos
dicen cosas distintas, ¿cuál vale?"). Respeta FR-008 y es útil, pero produce una fusión, no
conocimiento nuevo — y la fusión ya tiene su circuito completo en la spec 008. Sería una
segunda puerta a la misma habitación.

---

## D3 — Los escalados sin capitalizar dan cero hoy

**Lo medido**: los dos escalados `RESOLVED` tienen `resolvedWithDocumentId` y
`resolvedWithAction = CORRECTED`. O sea que ambos ya se capitalizaron, por el camino que la
spec 007 agregó al resolver.

**Qué significa**: la señal es estructuralmente correcta —el campo distingue con precisión
el caso capitalizado del que no— pero está vacía. Que la spec 007 funcione bien es
justamente lo que la vacía.

**Decisión**: se conserva como una de las dos piernas, sin depender de ella. Se llena sola
cada vez que alguien resuelve un caso sin marcar "enseñarle al agente", que es el
comportamiento por defecto. El que sostiene el respaldo hoy es el escalado pendiente.

**Consecuencia para las pruebas**: el camino de "resuelto sin capitalizar" no tiene datos
reales con que ejercitarse. Hay que fabricar el caso a mano (resolver un escalado sin
enseñar) para poder verlo funcionar, y eso va al quickstart.

---

## D4 — La entrevista no necesita el transporte en tiempo real

**Lo que se creía**: la entrevista va por el chat del panel sobre el transporte de la spec
004, que se construyó declarándose habilitador de este sprint, "cuyas sesiones son
conversacionales y largas".

**Lo que se encontró leyendo el código**: `RealtimeService` está indexado por
`conversationId` (`conversationChannel()`, `src/realtime/realtime.types.ts:13`) y sus
eventos son `message` y `status` **de una `Conversation`**. Usarlo obliga a que la
entrevista sea una conversación.

**Por qué eso rompe algo concreto**: los turnos de una conversación alimentan
`ROUTED_TO_AGENT`, que es de donde el barrido de cobertura saca sus consultas. Una entrevista
montada sobre una conversación metería sus propios turnos en el conteo del que salen sus
preguntas — la feature contaminando su propia fuente. Habría que excluirlos explícitamente,
y una exclusión que alguien tiene que acordarse de mantener es la clase de fallo silencioso
que este proyecto trata de no crear.

**Decisión**: sin transporte nuevo y sin conversación. Lo lento son dos momentos y los dos
son trabajos en cola, calcando el patrón de las specs 008 y 009:

| Momento | Cómo | Estado de la sesión |
|---|---|---|
| Abrir | job: redacta las N preguntas en una pasada | `PREPARANDO` → `EN_CURSO` |
| Responder | POST plano, sin LLM | `EN_CURSO` |
| Cerrar | job: redacta una ficha por respuesta | `CERRANDO` → `EN_REVISION` |

Contestar es inmediato porque las preguntas ya están escritas desde que se abrió (FR-006a).
El Principio IV se respeta sin transporte nuevo: ninguna llamada al modelo vive en un request.

**Alternativa descartada**: un canal propio en el bus, por sesión. Agrega tipos de evento y
superficie de transporte para un flujo que es pregunta-respuesta por turnos, donde quien
espera es la misma persona que acaba de apretar el botón.

---

## D5 — La detección de respuesta pobre no puede ser una llamada al modelo

**El problema**: FR-018 repregunta cuando la respuesta no da para producir conocimiento.
Detectarlo bien pide entender el contenido, y eso es una llamada al modelo dentro del
request de contestar — justo lo que D4 acaba de sacar.

**Lo que no sirve**: un umbral de longitud. "El plazo es 30 días hábiles" son cinco palabras
y es conocimiento perfectamente bueno; "sí, claro, por supuesto" son cuatro y no es nada.

**Decisión**: heurística barata que reconoce **solo el asentimiento vacío** —la respuesta
completa consiste en muletillas y confirmaciones, sin ninguna palabra con contenido— y que
en la duda **no** repregunta (FR-018a).

**Por qué asimétrica**: los dos errores no cuestan lo mismo. Dejar pasar una respuesta pobre
es barato: se ve al armar la ficha, y la ficha se descarta en la revisión. Repreguntarle a
alguien que ya contestó bien lo trata de tonto, y es la clase de fricción por la que una
herramienta interna se deja de usar.

---

## D6 — El aviso de parecido hay que calcularlo antes de escribir

**Lo que se encontró**: `KnowledgeService.buscarParecidos()` es **privado** y corre
**después** de ingestar — recibe `excluirId`, el id del documento recién creado
(`src/ai/knowledge/knowledge.service.ts:467`). Es deliberado: la spec 007 lo definió como
"información que acompaña al resultado de la carga, no una validación" y explícitamente no
bloquea nada.

**Por qué no alcanza acá**: FR-029 lo quiere antes de aprobar. Avisar del parecido después
de haber escrito el documento informa del duplicado en vez de evitarlo, y evitarlo es la
defensa central de esta feature (SC-001).

**Decisión**: extraer el predicado a un método público que compare contenido **sin** requerir
un documento existente, y dejar que `ingest()` siga usándolo igual que hoy. Es extracción,
no duplicación.

**Precedente directo**: es exactamente lo que se hizo la semana pasada con
`esResponsableDeAgente`, extraído de `assertPuedeEscribir` sobre un helper privado común
(spec 009). Ahí la regla era constitucional y no podía vivir en dos lados; acá el motivo es
el mismo, y la prueba de que salió bien es que los tests originales quedaron verdes sin
tocarlos.

**Alternativa descartada**: ingestar y después avisar, ofreciendo fusionar. Deja el duplicado
creado y depende de que alguien haga la limpieza — que es la spec 008 entera.

---

## Lo que NO se investigó, a propósito

- **Cuántas preguntas rinde una sesión.** Depende de cuánta gente la use, y no hay uso
  todavía. El tope va por variable de entorno y se ajusta con datos.
- **Si el modelo redacta buenas preguntas.** Es cualitativo y se evalúa mirándolas, no
  midiendo. Lo que sí se testea es que la sesión quede bien armada aunque el modelo falle.
- **Rendimiento.** Dos trabajos en cola por sesión y sesiones que abre una persona por vez:
  no hay presión de escala que estudiar.
