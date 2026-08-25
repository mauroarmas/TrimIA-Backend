# Modelo de datos — Entrevista desde el tráfico real

**Plan**: [plan.md](./plan.md) · **Fase 0**: [research.md](./research.md)

Tres modelos nuevos y cinco enums. Nada se toca de lo existente salvo las relaciones
inversas y **un método que pasa de privado a público** (D6).

## Enums

```prisma
enum InterviewStatus {
  PREPARANDO  // el job está redactando las preguntas
  EN_CURSO    // hay preguntas y se puede contestar
  CERRANDO    // el job está armando las fichas
  EN_REVISION // hay candidatos esperando aprobación
  CERRADA     // se revisaron todos los candidatos
  ABANDONADA  // sin actividad más allá del plazo; sus candidatos siguen aprobables
  FALLIDA     // el job de apertura no pudo armar la sesión
}

enum InterviewQuestionOrigin {
  TEMA_COBERTURA           // salió del resumen de la spec 009
  ESCALADO_SIN_CAPITALIZAR // caso resuelto que nunca se guardó como conocimiento
  ESCALADO_PENDIENTE       // caso que nadie contestó todavía
}

enum InterviewQuestionKind {
  PEDIR_NUEVO  // no hay documento cerca: se pide conocimiento nuevo
  CORREGIR     // hay documento y quedó corto o contestó al límite: se pide qué le falta
  GENERALIZAR  // hay una resolución escrita: se propone una versión sin el caso puntual
  ABIERTA      // no hay nada escrito que proponer (escalado pendiente)
}

enum InterviewQuestionStatus {
  PENDIENTE
  RESPONDIDA
  SALTEADA
  SIN_RESPONDER // se repreguntó y la segunda respuesta tampoco alcanzó
}

enum InterviewCandidateStatus {
  PENDIENTE
  APROBADO
  DESCARTADO
  FALLIDO // el job no pudo redactar la ficha; la respuesta cruda sigue ahí
}
```

**No hay `PAUSADA`.** Pausar no es una transición: es dejar de contestar. `EN_CURSO` con
`lastActivityAt` viejo ya dice todo lo que hace falta, y un estado explícito obligaría a
mantener sincronizadas dos representaciones de lo mismo. FR-021 se cumple igual — la sesión
se retoma porque nunca dejó de estar en curso.

**La clase de candidato no es un enum aparte**: sale de `InterviewQuestion.kind`. `CORREGIR`
y `GENERALIZAR` producen corrección cuando apuntan a un documento; `PEDIR_NUEVO` y `ABIERTA`
producen documento nuevo. Guardarlo dos veces invita a que se contradigan.

## `InterviewSession`

```prisma
model InterviewSession {
  id         String          @id @default(uuid())
  status     InterviewStatus @default(PREPARANDO)

  // El área. Se guardan los dos: el sector es a quién le corresponde, el agente
  // es dónde va a quedar el conocimiento. Hoy se derivan uno del otro, pero el
  // sector puede cambiar de agente y las sesiones viejas no deben moverse.
  sectorId   String
  sector     Sector          @relation(fields: [sectorId], references: [id])
  agentType  AgentType

  openedById String
  openedBy   Employee        @relation("EntrevistasAbiertas", fields: [openedById], references: [id])

  // De qué corrida salieron las preguntas, cuando salieron de una. Null =
  // la sesión se armó con las señales de respaldo (FR-013).
  coverageScanId String?
  coverageScan   CoverageScan? @relation(fields: [coverageScanId], references: [id])

  // Por qué falló, cuando FALLIDA. Se muestra: una sesión que no arranca sin
  // decir por qué es indistinguible de una que se colgó.
  failureReason String?

  questions  InterviewQuestion[]
  candidates InterviewCandidate[]

  lastActivityAt DateTime @default(now())
  closedAt       DateTime?
  createdAt      DateTime @default(now())

  // Una sola sesión sin cerrar por persona y área (FR-003). Parcial: solo
  // aplica a los estados abiertos, así que se resuelve en el servicio, no con
  // un @@unique — Prisma no tiene índices únicos parciales.
  @@index([openedById, sectorId, status])
  @@index([status, lastActivityAt])
}
```

## `InterviewQuestion`

El material que la sustenta se **copia acá al abrir** (FR-004). Nada de esto se vuelve a
leer de su fuente: el resumen de cobertura expone solo la última corrida y puede cambiar
mientras alguien responde.

```prisma
model InterviewQuestion {
  id        String           @id @default(uuid())
  sessionId String
  session   InterviewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  order  Int
  origin InterviewQuestionOrigin
  kind   InterviewQuestionKind
  status InterviewQuestionStatus @default(PENDIENTE)

  /// El texto ya redactado al abrir la sesión (FR-006a). No se regenera.
  text String

  // --- Material copiado, según el origen ---

  /// Etiqueta del tema de cobertura, o null si vino de un escalado.
  themeLabel String?
  /// Las mismas queryEventIds del CoverageTheme de origen (spec 009). Es lo que
  /// permite reconocer, en la PRÓXIMA sesión de esta área, que un tema ya se
  /// preguntó — por solapamiento, igual que la spec 009 identifica un tema
  /// reincidente. La etiqueta no sirve para esto: se regenera distinta cada
  /// corrida (FR-006c).
  themeQueryEventIds String[] @default([])
  /// Consultas reales del tema, ya anonimizadas por la spec 009 (FR-012).
  quotes     String[]
  /// La resolución del caso, cuando kind = GENERALIZAR. Es lo que se muestra
  /// para que la persona confirme una versión general — NUNCA lo que se
  /// ingesta (FR-013b): está escrito para un cliente concreto.
  resolutionText String?

  /// El documento a corregir, con la versión que tenía al abrir. La versión es
  /// lo que permite detectar que cambió mientras la entrevista estaba abierta
  /// (FR-030) en vez de pisarlo a ciegas.
  documentId      String?
  document        KnowledgeDocument? @relation("EntrevistaCorrige", fields: [documentId], references: [id])
  documentVersion Int?

  /// De qué caso salió, cuando el origen es un escalado. Permite cerrar el
  /// círculo: el caso pendiente que se contestó acá deja de estar huérfano.
  escalationId String?
  escalation   Escalation? @relation(fields: [escalationId], references: [id])

  answers   InterviewAnswer[]
  candidate InterviewCandidate?

  @@unique([sessionId, order])
  @@index([sessionId, status])
}
```

**`quotes` es `String[]` y no una relación.** Igual que en la spec 009: son un recorte
anonimizado para leer, no un enlace de vuelta a la conversación — que FR-012 prohíbe.

**Excluir lo ya preguntado (FR-006b/c) reusa, sin modificarlas, `overlap()` y
`resolveMark()`** de `src/ai/knowledge/knowledge-coverage-identity.ts` (spec 009): al armar
el material de una sesión nueva, cada tema candidato se compara por `overlap()` contra los
`themeQueryEventIds` de las `InterviewQuestion` de sesiones anteriores de la misma área
(cualquier estado salvo `FALLIDA`), con el mismo corte `COVERAGE_THEME_OVERLAP`. Por encima
del corte, se descarta. Para escalados, la exclusión es más simple: cualquier `escalationId`
que ya aparezca en una `InterviewQuestion` de una sesión no `FALLIDA` de esa área queda
afuera.

## `InterviewAnswer`

Una fila por intento. Hay dos cuando se repreguntó (FR-018), y las dos se conservan: la
primera es la que explica por qué se repreguntó.

```prisma
model InterviewAnswer {
  id         String            @id @default(uuid())
  questionId String
  question   InterviewQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)

  /// Lo que la persona escribió, tal cual (FR-035). Es la fuente para rehacer
  /// una ficha que el modelo redactó mal o no pudo redactar.
  text    String
  attempt Int  @default(1)
  /// true si el sistema la consideró vacía y repreguntó (FR-018a).
  flaggedThin Boolean @default(false)

  createdAt DateTime @default(now())

  @@unique([questionId, attempt])
}
```

## `InterviewCandidate`

```prisma
model InterviewCandidate {
  id         String           @id @default(uuid())
  sessionId  String
  session    InterviewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  questionId String           @unique
  question   InterviewQuestion @relation(fields: [questionId], references: [id], onDelete: Cascade)

  status InterviewCandidateStatus @default(PENDIENTE)

  title    String
  /// Hallazgo de implementación: `KnowledgeDocument.category` es obligatoria
  /// al ingestar (spec 5A) y ningún camino de esta feature la deriva sola.
  /// Se prellena con la etiqueta del tema cuando la pregunta vino de
  /// cobertura, y es editable como el resto de la ficha (FR-026).
  category String
  /// Lo que redactó el modelo. Se conserva aunque se edite, para poder
  /// comparar qué cambió la persona.
  proposedContent String
  /// Lo que la persona dejó. Null = no la tocó. Lo que se ingesta es
  /// `editedContent ?? proposedContent` (FR-028).
  editedContent   String?
  audience        Audience @default(INTERNO)

  /// Cuando corrige, a qué documento y desde qué versión. Se copian de la
  /// pregunta pero viven acá también: la persona puede cambiar un candidato
  /// nuevo a corrección desde el aviso de parecido (FR-029), y esa decisión
  /// es del candidato, no de la pregunta.
  targetDocumentId String?
  targetDocument   KnowledgeDocument? @relation("EntrevistaCorrigeCandidato", fields: [targetDocumentId], references: [id])
  targetVersion    Int?

  /// El documento que produjo al aprobarse.
  resultDocumentId String?
  resultDocument   KnowledgeDocument? @relation("EntrevistaProdujo", fields: [resultDocumentId], references: [id])

  /// Por qué falló, cuando FALLIDO o cuando la aprobación se rechazó.
  failureReason String?

  resolvedById String?
  resolvedBy   Employee? @relation("CandidatosResueltos", fields: [resolvedById], references: [id])
  resolvedAt   DateTime?
  createdAt    DateTime  @default(now())

  @@index([sessionId, status])
}
```

**`targetDocumentId` está en el candidato y no solo en la pregunta** porque son decisiones
de momentos distintos: la pregunta sabe qué documento quedó corto; el candidato sabe a cuál
se decidió aplicar, que puede ser otro si el aviso de parecido señaló uno mejor.

**El contrato expone `candidateKind` (`NUEVO`/`CORRECCION`), derivado de `targetDocumentId`
—no de `InterviewQuestion.kind`** y no persistido aparte: `targetDocumentId != null` es
`CORRECCION`. Guardarlo como campo propio invitaría a que se desincronice de
`targetDocumentId`, que es la fuente real. El nombre es distinto del `kind` de la pregunta
a propósito — son dos ejes que responden preguntas distintas y confundirlos en el panel es
el problema que motivó separarlos.

## Relaciones inversas en modelos existentes

| Modelo | Campo | Por qué |
|---|---|---|
| `Employee` | `entrevistasAbiertas`, `candidatosResueltos` | Quién abrió y quién aprobó |
| `Sector` | `entrevistas` | El área de la sesión |
| `CoverageScan` | `entrevistas` | De qué corrida salieron las preguntas |
| `KnowledgeDocument` | `entrevistaPreguntas`, `entrevistaCandidatos`, `entrevistaProdujo` | Documento a corregir, destino elegido, y resultado |
| `Escalation` | `entrevistaPreguntas` | El caso del que salió la pregunta |

`KnowledgeDocument.sourceType = ENTREVISTA` y `sourceId = InterviewSession.id` ya estaban
previstos: el enum se cerró en el Sprint 5A justamente para no migrarlo dos veces
([`schema.prisma:53`](../../prisma/schema.prisma#L53)).

## Cierre del escalado al aprobar (FR-035a/b)

Cuando se aprueba un candidato cuya pregunta tiene `origin = ESCALADO_PENDIENTE`, el
servicio de aprobación actualiza la `Escalation` referenciada por
`InterviewQuestion.escalationId` directamente por Prisma —**no** llama a
`EscalationsService.resolve()`, que envía el mensaje al usuario original y no aplica acá
(FR-035b)—: `status: RESOLVED`, `resolvedById`, `resolution` (el contenido aprobado),
`resolvedAt`. **No** se toca `resolvedWithDocumentId`/`resolvedWithAction`: ese par, por su
propio comentario en el esquema, es "con qué documento se cerró el caso **cuando NO se creó
uno nuevo**" — y acá siempre se crea uno. Forzarlo ahí violaría la invariante que ese campo
ya tenía antes de esta spec.

**"Sin capitalizar" (FR-013e) se decide con las tres señales, no una** — el gap que
encontró el `/speckit-analyze`: `resolvedWithDocumentId != null` (corregido, spec 007) **o**
existe un `KnowledgeDocument` con `sourceType: ESCALADO, sourceId: <la escalación>`
(enseñado, spec 005) **o** existe un `InterviewCandidate` aprobado cuya `question.escalationId`
apunta a esa escalación (esta spec). Comprobar solo el primero deja pasar como "sin
capitalizar" un caso que sí produjo documento por cualquiera de los otros dos caminos.

## Cambio en código existente (no en el esquema)

`KnowledgeService.buscarParecidos()` pasa de privada a un método público que **no exige un
documento existente** (D6). `ingest()` la sigue usando igual. Es extracción, no duplicación
— el mismo movimiento que `esResponsableDeAgente` en la spec 009, donde los tests originales
quedaron verdes sin tocarlos, que es la prueba de que la extracción salió bien.

## Variables de entorno nuevas

Todas con Joi en `config.module.ts` y documentadas en `.env.example`.

| Variable | Default | Qué controla |
|---|---|---|
| `INTERVIEW_MAX_QUESTIONS` | `7` | Tope de preguntas por sesión (FR-006) |
| `INTERVIEW_MAX_QUOTES_PER_QUESTION` | `2` | Consultas de ejemplo por pregunta (FR-011) |
| `INTERVIEW_ABANDON_DAYS` | `7` | Inactividad hasta pasar a abandonada (FR-022) |
| `INTERVIEW_MAX_ESCALATIONS_FALLBACK` | `10` | Cuántos escalados se miran para el respaldo (FR-013) |

**Se reusa `KNOWLEDGE_SIMILARITY_THRESHOLD`** para el aviso de parecido (FR-029). Es el
mismo juicio que al cargar a mano; dos umbrales para lo mismo se despegan con el tiempo y
el corpus termina con dos criterios de duplicado según por dónde entró el documento.
