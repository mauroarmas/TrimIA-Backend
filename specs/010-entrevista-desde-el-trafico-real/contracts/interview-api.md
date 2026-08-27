# Contratos — Entrevista desde el tráfico real

**Plan**: [plan.md](../plan.md) · **Modelo**: [data-model.md](../data-model.md)

Nueve endpoints bajo `/interviews`, en un módulo nuevo `src/interviews/`. Todos con
`@Roles('SUPERVISOR')` a nivel de controller **y** verificación de responsabilidad de área
por operación — los dos gates, como en `knowledge.controller.ts` (FR-036).

**Ninguno escribe el corpus salvo `POST /interviews/candidates/:id/approve`**, y ése lo hace
a través de `KnowledgeService`, no por su cuenta. La regla de escritura por área vive en
`assertPuedeEscribir` y en ningún otro lado (Principio I).

---

## `POST /interviews` — abrir una sesión

Encola el armado y devuelve; no espera (Principio IV, D4).

**Body**: `{ "sectorId": "…" }`

**202**

```jsonc
{ "id": "…", "status": "PREPARANDO", "sectorId": "…", "agentType": "SALES" }
```

| Código | Cuándo |
|---|---|
| **409** | Ya hay una sesión sin cerrar de esa persona para esa área: se devuelve **esa**, con su `status`. No se crea una segunda (FR-003) |
| **403** | No es responsable del área (FR-002) |
| **422** | No hay temas de cobertura **ni** señales de respaldo, **después de excluir** los ya usados en una entrevista anterior de la misma área (FR-006b). Lleva `reason`, ver abajo (FR-016) |

**El material se arma excluyendo lo ya preguntado.** Antes de elegir temas y escalados, el
sistema descarta los que ya se usaron en una entrevista de la misma área que llegó a
producir preguntas (cualquier estado salvo `FALLIDA`). Un tema se identifica por
solapamiento de sus consultas, igual que la spec 009 identifica un tema reincidente — nunca
por su etiqueta, que el resumen de cobertura regenera distinta cada corrida. Un escalado se
identifica por su id. Sin esto, entrevistar la misma área dos veces repite la mitad de las
preguntas (FR-006b, FR-006c).

El 422 distingue el motivo, porque no son intercambiables aunque los tres den cero preguntas:

| `reason` | Qué pasó | Qué ofrece el panel |
|---|---|---|
| `SIN_CORRIDA` | Nunca se corrió el barrido de cobertura | Correrlo |
| `SIN_MUESTRA_SUFICIENTE` | Hay tráfico pero no alcanza | Cuánto falta |
| `TODO_CUBIERTO` | Corrió, no encontró huecos, y no hay escalados | Nada que hacer — está bien |

---

## `GET /interviews/:id` — el estado de la sesión

Es lo que el panel consulta mientras `PREPARANDO` y `CERRANDO`. **Poll, no stream** (D4).

**200**

```jsonc
{
  "id": "…", "status": "EN_CURSO",
  "sector": { "id": "…", "name": "Ventas" }, "agentType": "SALES",
  "progress": { "answered": 3, "total": 7 },
  "fromCoverage": true,          // false = la sesión se armó con el respaldo
  "current": {
    "id": "…", "order": 4,
    "kind": "CORREGIR",
    "origin": "TEMA_COBERTURA",
    "text": "Varias consultas sobre plazos de entrega quedaron sin respuesta firme. El documento que tenemos dice solo que «los envíos salen semanalmente». ¿Qué le falta para contestar bien?",
    "quotes": ["cuanto tarda en llegar a posadas?"],
    "document": { "id": "…", "title": "Envíos y logística", "version": 3, "content": "…" },
    "resolutionText": null,
    "retried": false
  },
  "failureReason": null
}
```

Notas del contrato:

- **`current` es `null`** cuando no quedan pendientes o el estado no es `EN_CURSO`. El panel
  no debe inferir el fin por `answered === total`: una sesión cerrada anticipadamente llega
  a `EN_REVISION` con pendientes (FR-023a).
- **`kind` decide qué se muestra**, y son cuatro formas distintas, no una con variantes:

  | `kind` | Trae | Qué se pide |
  |---|---|---|
  | `PEDIR_NUEVO` | `quotes` | Conocimiento nuevo |
  | `CORREGIR` | `quotes` + `document` con su contenido | Qué le falta al documento |
  | `GENERALIZAR` | `resolutionText` | Confirmar una versión sin el caso puntual |
  | `ABIERTA` | `quotes` | La respuesta; no hay texto que proponer |

- **`document.content` viaja entero.** Sin verlo no se puede decir qué le falta, que es
  literalmente la pregunta.
- **`failureReason`** solo con `status: FALLIDA`. Una sesión que no arranca sin decir por qué
  es indistinguible de una colgada.

---

## `POST /interviews/:id/answer` — contestar

**Sin llamada al modelo**: las preguntas ya están redactadas (FR-006a, FR-017b). Guarda y
devuelve la siguiente.

**Body**: `{ "questionId": "…", "text": "…" }`

**200**

```jsonc
{
  "accepted": true,
  "retry": false,        // true = se consideró vacía y se repregunta (FR-018)
  "retryHint": null,     // el pedido de concretar, cuando retry es true
  "progress": { "answered": 4, "total": 7 },
  "next": { /* misma forma que `current`, o null si no quedan */ },
  "status": "EN_CURSO"   // pasa a CERRANDO al contestarse la última (FR-023a)
}
```

**409** si la pregunta no es la actual, ya está respondida, o la sesión no está `EN_CURSO`.
Evita que dos pestañas abiertas escriban dos respuestas a la misma pregunta.

`retry` se decide con una heurística barata que reconoce **solo el asentimiento vacío** y
que ante la duda **no** repregunta (FR-018a, D5). Al segundo intento nunca es `true`: la
pregunta pasa a `SIN_RESPONDER` y se sigue.

---

## `POST /interviews/:id/skip` — saltear

**Body**: `{ "questionId": "…" }` · **200**: igual que `answer`. No produce candidato (FR-019).

---

## `POST /interviews/:id/finish` — terminar ahora

Encola el armado de fichas. Disponible **aunque queden pendientes** (FR-023a).

**Body**: `{ "confirmPending": true }` — obligatorio si quedan pendientes.

**202**: `{ "id": "…", "status": "CERRANDO", "pendingSkipped": 4 }`

**400** si quedan pendientes y no vino `confirmPending`. La respuesta dice **cuántas**: en
revisión ya no se contesta nada, así que un cierre por error cuesta el resto de la
entrevista (FR-023b).

---

## `GET /interviews/:id/candidates` — la pantalla de revisión

**200**

```jsonc
{
  "sessionId": "…", "status": "EN_REVISION",
  "candidates": [
    {
      "id": "…",
      "status": "PENDIENTE",
      "candidateKind": "NUEVO",
      "title": "Plazos de entrega a Posadas",
      "content": "…",                 // editedContent ?? proposedContent
      "edited": false,
      "audience": "INTERNO",
      "question": { "order": 4, "text": "…", "origin": "TEMA_COBERTURA" },
      "rawAnswer": "…",
      "target": null,
      "similar": [
        { "documentId": "…", "title": "Envíos y logística", "score": 0.78, "audienciaDistinta": false }
      ],
      "canApprove": true
    }
  ]
}
```

- **`similar[].score` es 0-1** ("1 - distancia coseno"), igual que el `SimilarDocument` de la spec 007 — no 0-100 como `bestScore` de la spec 009, que es una métrica distinta. El campo se reusa tal cual de `KnowledgeService.buscarParecidos()`, sin conversión.
- **`similar` se calcula al pedir la revisión, antes de escribir nada** (FR-029, D6). Es la
  defensa contra duplicados de esta feature: informarlo después de guardar avisa del
  duplicado en vez de evitarlo.
- **`similar` va vacío en los candidatos que ya son corrección**: no hay nada que evitar,
  ya apuntan a un documento.
- **`candidateKind`** es `NUEVO` o `CORRECCION` — **no confundir con el `kind` de la
  pregunta** (`PEDIR_NUEVO`/`CORREGIR`/`GENERALIZAR`/`ABIERTA`, ver `GET /interviews/:id`):
  son dos ejes distintos. `kind` de la pregunta dice qué se preguntó; `candidateKind` dice
  qué se va a escribir, y puede cambiar si la persona convierte un candidato nuevo en
  corrección desde el aviso de parecido (FR-029) — el `kind` de la pregunta no cambia nunca.
- **`target`** es `null` o `{ documentId, title, version, changedSinceOpen }`.
  `changedSinceOpen` compara contra la versión copiada al abrir (FR-030).
- **`rawAnswer`** es lo que la persona escribió, para poder comparar con lo que redactó el
  modelo (FR-035).
- **`canApprove`** lo resuelve el backend por área (FR-032). Un candidato se **ve** aunque
  sea `false` — ver no es editar.

---

## `PATCH /interviews/candidates/:id` — editar antes de aprobar

**Body** (todo opcional): `{ "title", "content", "audience", "targetDocumentId" }`

`targetDocumentId` es lo que convierte un candidato nuevo en corrección desde el aviso de
parecido; mandarlo en `null` lo devuelve a nuevo (FR-029, FR-031).

**200**: el candidato actualizado. **409** si el candidato ya no está `PENDIENTE`.

---

## `POST /interviews/candidates/:id/approve` — al corpus

También acepta `POST /interviews/:id/candidates/approve` con `{ "ids": [...] }` para
"aprobar todo".

**200**

```jsonc
{
  "results": [
    { "candidateId": "…", "ok": true,  "documentId": "…", "action": "CREATED" },
    { "candidateId": "…", "ok": false, "code": "AREA_AJENA", "message": "…" },
    { "candidateId": "…", "ok": false, "code": "VERSION_CAMBIO", "currentVersion": 5 }
  ],
  "sessionStatus": "EN_REVISION"
}
```

**Un fallo no cancela los demás** (FR-027). Por eso la respuesta es `200` con resultados por
candidato y no un error de conjunto: en un lote de cuatro, que uno sea de un área que la
persona perdió no es motivo para no guardar los otros tres.

| `code` | Qué pasó |
|---|---|
| `AREA_AJENA` | Dejó de ser responsable del área (FR-032) |
| `VERSION_CAMBIO` | El documento a corregir cambió; trae la versión actual (FR-030) |
| `DOCUMENTO_AUSENTE` | El documento a corregir ya no existe o no está activo (FR-031) |
| `DUPLICADO_EXACTO` | El contenido ya está idéntico en el corpus |

`action` es `CREATED` o `CORRECTED`. La sesión pasa a `CERRADA` cuando no queda ningún
candidato `PENDIENTE` — aprobados y descartados cuentan igual: lo que importa es que se
revisaron.

**Aprobar un candidato de escalado pendiente además cierra ese caso** (FR-035a): el
escalado pasa a resuelto, con la resolución y el documento que produjo. **No** le envía
nada al usuario original — es distinto de responderle al cliente, y el caso puede ser
viejo. Sin este cierre, el mismo caso vuelve a aparecer en la cola de escalados pendientes
y, en la próxima entrevista, en el material de preguntas (FR-006b).

---

## `POST /interviews/candidates/:id/discard` — descartar

**200**: `{ "discarded": true, "sessionStatus": "EN_REVISION" }`

Descartar no borra: el candidato queda `DESCARTADO` con su respuesta cruda. Que una
entrevista no haya producido nada es un dato sobre la entrevista, no basura.

---

## Lo que NO se expone

- **Ningún endpoint que cree o edite un `KnowledgeDocument` desde este módulo.** La
  aprobación llama a `KnowledgeService`; la regla de área vive ahí (Principio I).
- **Ningún stream.** La entrevista es pregunta-respuesta por turnos; lo asíncrono son los
  dos jobs, que se consultan con `GET /interviews/:id` (D4).
- **Ningún listado global de sesiones ajenas.** Esta spec no tiene pantalla de "entrevistas
  de todos"; cada quien ve las suyas.
