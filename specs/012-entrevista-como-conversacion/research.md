# Fase 0 — Investigación

**Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

La spec entró a planificación **sin marcadores `NEEDS CLARIFICATION`**: la sesión de
`/speckit-clarify` del 2026-08-25 cerró las cuatro ambigüedades de producto (persistencia de
opciones, gesto de elegir vs. enviar, interacción con la repregunta, y estatus de SC-002).

Lo que queda para esta fase es distinto: **cómo se implementa lo ya decidido**, medido contra
el código que existe. Cinco decisiones, todas verificadas contra el repo antes de fijarlas.

---

## D1 — Las opciones viajan dentro del schema que ya redacta las preguntas

**Decisión**: agregar un campo `opciones: string[]` a cada entrada de `preguntasSchema` en
[interviews-drafting.service.ts:18](../../src/interviews/interviews-drafting.service.ts#L18),
en vez de una segunda llamada al modelo o un método aparte.

**Rationale**: FR-011 exige costo fijo y prohíbe regenerar por pregunta; la spec 010 (D4, y
su `Performance Goals`) fijó que abrir una sesión cuesta **una** llamada de chat. Un método
nuevo, aunque corriera en el mismo job, agregaría una llamada por sesión y rompería esa
garantía sin ganar nada: el material que necesita para proponer opciones es exactamente el
mismo que ya recibe para redactar la pregunta (`describirItem`).

**Verificado**: la forma anidada que hace falta —un array de strings dentro de un array de
objetos— **ya está en producción** en
[knowledge-coverage-grouping.ts:59](../../src/ai/knowledge/knowledge-coverage-grouping.ts#L59)
(`queryIds: z.array(z.string())`). No es terreno nuevo con Gemini estructurado.

**Alternativas descartadas**:

- *Una segunda llamada al abrir, solo para opciones*: rompe el costo fijo declarado, y
  duplica el envío del material.
- *Generar al llegar a cada pregunta*: prohibido por FR-011, y metería una llamada al modelo
  dentro de un request — violación directa del Principio IV.

---

## D2 — Las opciones se guardan como `String[]` en la pregunta, no en una tabla

**Decisión**: `InterviewQuestion.options String[] @default([])`.

**Rationale**: la clarificación fijó que se persisten congeladas junto a la pregunta, y que
lo que se registra al responder es **el texto resultante, no una referencia a la opción**
(una opción editada deja de coincidir con la propuesta). Sin referencia que mantener, una
tabla con id por opción no compra nada y agrega un join a cada lectura del envelope.

**Verificado**: es el patrón dominante del propio modelo — `InterviewQuestion` ya guarda
`quotes String[]` y `themeQueryEventIds String[] @default([])`
([schema.prisma:1201-1203](../../prisma/schema.prisma#L1201)). Postgres + Prisma soportan
arrays de escalares nativamente; el proyecto los usa en siete modelos.

**Alternativas descartadas**:

- *Tabla `InterviewQuestionOption`*: habilitaría registrar *cuál* opción se eligió, pero eso
  es justamente lo que la clarificación decidió **no** rastrear. Complejidad sin demanda.
- *JSON*: pierde tipado y no gana nada sobre `String[]` para una lista de strings planos.

---

## D3 — El historial viaja entero en `GET /interviews/:id`, sin endpoint ni paginación

**Decisión**: agregar `history[]` al envelope que ya devuelve
[`GET /interviews/:id`](../010-entrevista-desde-el-trafico-real/contracts/interview-api.md),
junto a `current`. Sin ruta nueva.

**Rationale**: tres razones convergen.

1. **Escala**: una sesión son 3-8 preguntas (spec 010, `Scale/Scope`). El historial completo
   son decenas de filas cortas. Paginar algo que nunca pasa de una pantalla es complejidad
   que no se paga.
2. **Autorización**: el envelope ya está protegido por `@Roles('SUPERVISOR')` y
   `cargarSesionPropia`. Un endpoint nuevo sería **superficie nueva que autorizar** — y el
   Principio I dice que la autorización no se replica. Reusar la ruta la deja en un lugar.
3. **El panel ya la consulta**: `Interview.jsx` ya hace poll de esta ruta; el historial llega
   sin tocar `api.js`.

**Alternativas descartadas**:

- *`GET /interviews/:id/history`*: ruta nueva, gate nuevo, fetch nuevo en el panel. Todo para
  datos que caben en la respuesta que ya se pide.
- *Reconstruir el historial en el frontend acumulando respuestas*: se rompe al retomar una
  sesión pausada (FR-002), que es exactamente el caso que la spec exige cubrir.

---

## D4 — FR-009 se resuelve por coincidencia exacta contra las opciones guardadas

**Decisión**: un módulo nuevo y chico, `interviews-chosen-option.ts`, que responde una sola
pregunta: *¿este texto es una de las opciones de esta pregunta, sin editar?* Comparación
normalizada (trim + colapso de espacios), **sin modelo**. Si da `true`, `answer()` no llama a
`esAsentimientoVacio` y por lo tanto no repregunta.

**Rationale**: la regla nueva no pertenece a `esAsentimientoVacio` —que sigue respondiendo
"¿esto es un asentimiento vacío?", su pregunta de siempre— sino que la **envuelve**. Separarla
mantiene intacta la heurística de la spec 010 y su suite de tests, y deja la regla nueva
testeable sola. Es el precedente que el módulo ya sentó con
[interviews-thin-answer.ts](../../src/interviews/interviews-thin-answer.ts): una regla de
texto pura, sin dependencias, con su propio `.spec.ts`.

**Por qué normalizar y no comparar crudo**: el panel carga el texto en un `textarea`; un
espacio final accidental no debería convertir "eligió una opción" en "escribió algo parecido".
Normalizar de más (bajar a minúsculas, sacar tildes) sería un error opuesto: dos opciones que
difieren solo en acentuación son textos distintos, y editar la tilde **es** editar.

**Alternativas descartadas**:

- *Un flag `fromOption` en el body de `answer`*: el cliente decidiría si se valida o no su
  propia respuesta. Es autoreportado y falsificable; la verdad ya está en el servidor.
- *Comparación por similitud*: convertiría "editó un poco" en "no editó" según un umbral
  arbitrario. FR-009 dice **sin editar**, que es una condición binaria y exacta.

---

## D5 — Si el modelo no devuelve opciones, la sesión sigue; si no devuelve preguntas, no

**Decisión**: `opciones` ausente, vacío o con entradas en blanco → esa pregunta queda con
`options: []` y se muestra solo con texto libre. **No** se propaga el `null` que hoy hace
fallar la sesión entera.

**Rationale**: hay una asimetría deliberada en `redactarPreguntas`
([:127-133](../../src/interviews/interviews-drafting.service.ts#L127)): si falta el **texto**
de algún id, devuelve `null` y la sesión queda `FALLIDA` — sin pregunta no hay entrevista. Las
opciones son lo contrario: FR-006 exige explícitamente que su ausencia sea un estado normal, y
SC-004 que ninguna pregunta quede sin poder responderse por una falla al generarlas. Degradar
en silencio es aquí el comportamiento correcto, no un atajo.

**Consecuencia para SC-002**: por eso el umbral de "la mitad de las preguntas con opciones" es
diagnóstico y no gate (clarificación del 2026-08-25). Un modelo que devuelve pocas opciones
produce entrevistas peores, no entrevistas rotas — y se corrige ajustando el prompt.

**Alternativas descartadas**:

- *Fallar la sesión si faltan opciones*: contradice FR-006 y SC-004 de frente.
- *Rellenar con opciones genéricas*: es literalmente el riesgo que la pre-spec señala como
  principal. Una opción de relleno es peor que ninguna.
