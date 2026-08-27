# Modelo de datos — Una sola pantalla para mejorar el conocimiento

**Plan**: [plan.md](./plan.md) · **Fase 0**: [research.md](./research.md)

Dos modelos nuevos, dos enums, y **un modelo existente que se generaliza**. La entrevista
(spec 010) no se toca: se le cambia de dónde salen los ítems, no cómo se contestan.

## Enums

```prisma
enum DocReviewStatus {
  RUNNING
  READY
  FAILED
}

/// De qué fuente salió un ítem de la lista (FR-004, FR-020).
///
/// ⚠️ Nombra lo mismo que `InterviewQuestionOrigin` pero con otras palabras,
/// porque son dos ejes distintos: acá importa POR QUÉ el ítem está en la
/// lista, allá QUÉ forma toma la pregunta. El mapeo es:
///
///   CONSULTA_FALLIDA     ↔ TEMA_COBERTURA
///   ESCALADO             ↔ ESCALADO_SIN_CAPITALIZAR | ESCALADO_PENDIENTE
///   DOCUMENTO_INCONCLUSO ↔ DOCUMENTO_INCONCLUSO
///
/// El ESCALADO se abre en dos del lado de la entrevista a propósito: uno ya
/// tiene resolución escrita (se generaliza) y el otro no (se pregunta abierto).
enum ImprovementSource {
  CONSULTA_FALLIDA    // tema del resumen de cobertura (spec 009)
  ESCALADO            // caso escalado sin capitalizar (spec 010)
  DOCUMENTO_INCONCLUSO // señalamiento del detector (esta spec)
}
```

## `DocumentReview` — una corrida del detector sobre un área

```prisma
model DocumentReview {
  id     String          @id @default(uuid())
  status DocReviewStatus @default(RUNNING)

  /// El área revisada. Se guardan los dos por el mismo motivo que en la spec
  /// 010: el sector dice a quién le corresponde, el agente dice qué documentos
  /// entran — y un sector puede cambiar de agente sin que las corridas viejas
  /// se muevan.
  ///
  /// Qué documentos entran: los del `agentType` **más los transversales**
  /// (`agentType` nulo), que son 15 de los 75 activos. Sin ellos, un quinto
  /// del corpus no lo revisaría nadie nunca. Se analizan una vez —el
  /// incremental hace que la segunda área los saltee— pero sus señalamientos
  /// solo se MUESTRAN a quien es responsable de todas las áreas: es quien
  /// puede corregirlos, y un ítem que quien lo ve no puede tocar es ruido.
  sectorId  String
  sector    Sector    @relation(fields: [sectorId], references: [id])
  agentType AgentType

  startedById String
  startedBy   Employee @relation("DocReviewStartedBy", fields: [startedById], references: [id])

  /// Cuántos se miraron de verdad y cuántos se saltearon por no haber
  /// cambiado (FR-013a). Los dos hacen falta para el resumen de una línea
  /// (FR-006): "20 sin cambios, 2 revisados" explica por qué tardó 8s.
  documentsAnalyzed Int @default(0)
  documentsSkipped  Int @default(0)
  findingsFound     Int @default(0)

  /// El corte de severidad vigente al correr. Guardado con la corrida por el
  /// mismo motivo que `HygieneScan.threshold`: si alguien recalibra, las
  /// corridas viejas se explican con el número que usaron.
  severityCut Int

  failureReason String?

  findings DocumentFinding[]

  createdAt  DateTime  @default(now())
  finishedAt DateTime?

  @@index([sectorId, status, createdAt])
}
```

## `DocumentFinding` — el señalamiento sobre UN documento

```prisma
model DocumentFinding {
  id       String         @id @default(uuid())
  reviewId String
  review   DocumentReview @relation(fields: [reviewId], references: [id], onDelete: Cascade)

  documentId String
  document   KnowledgeDocument @relation("DocFinding", fields: [documentId], references: [id], onDelete: Cascade)
  /// La versión sobre la que se juzgó (FR-019). Hace dos trabajos: saltear el
  /// documento en la próxima corrida si no cambió (FR-013a), y decidir si un
  /// descarte sigue valiendo (FR-026).
  documentVersion Int

  /// 0-100 (D1/D2). NO es confianza: el modelo devuelve confianza alta para
  /// todo lo que marca (53 de 53 en la medición), así que no cortaba nada.
  /// Esto mide cuánto DUELE la carencia, que sí discrimina.
  ///
  /// ⚠️ Viene cuantizada: el modelo usa 85/75/65/55/45/20/15 y casi nunca
  /// valores intermedios. Cualquier corte entre 76 y 85 se comporta igual.
  severity Int

  /// Las preguntas concretas que el documento deja abiertas (FR-014). Nunca
  /// vacío: un señalamiento sin preguntas no habilita ninguna acción y no se
  /// persiste. Medido: 2,8 por señalamiento, ninguno vino vacío.
  unansweredQuestions String[]
  reason              String

  createdAt DateTime @default(now())

  @@unique([reviewId, documentId])
  @@index([reviewId, severity])
  /// Para resolver "el señalamiento VIGENTE de este documento" sin pasar por
  /// la corrida que lo produjo.
  @@index([documentId, documentVersion])
}
```

> [!IMPORTANT]
> **La lista se arma con el último señalamiento VIGENTE de cada documento, no con
> los de la última corrida.** Es la consecuencia directa del incremental
> (FR-013a): una segunda corrida que saltea 20 documentos y analiza 2 produce una
> `DocumentReview` con **2** findings, pero los otros 20 siguen siendo verdad —
> nadie tocó esos documentos. Leer "los findings de la última revisión" vaciaría la
> pantalla en la segunda corrida.
>
> Vigente = el finding cuyo `documentVersion` coincide con la `version` actual del
> documento. Si no coincide, el documento se editó y se reanaliza (FR-013a); hasta
> que eso pase, ese señalamiento juzgó otro texto y no se muestra.

## `ImprovementDismissal` — el descarte, para las tres fuentes

Reemplaza a `CoverageThemeMark`, que solo servía para una (FR-024a). Es **el mismo gesto
sobre fuentes distintas**; sostener dos mecanismos que hacen lo mismo es el ruido que esta
spec vino a sacar.

```prisma
model ImprovementDismissal {
  id     String            @id @default(uuid())
  source ImprovementSource

  /// A qué apunta, según la fuente. Uno solo está lleno:
  ///  - CONSULTA_FALLIDA     → themeQueryEventIds (identidad por solape, spec 009 D6)
  ///  - ESCALADO             → escalationId
  ///  - DOCUMENTO_INCONCLUSO → documentId + documentVersion
  ///
  /// Sin FK a CoverageTheme a propósito: el tema es una fila por corrida y
  /// desaparece en la siguiente. La identidad estable son sus consultas —
  /// el mismo criterio que la spec 009 ya usa para reconocer un reincidente.
  themeQueryEventIds String[] @default([])

  escalationId String?
  escalation   Escalation? @relation(fields: [escalationId], references: [id])

  documentId String?
  document   KnowledgeDocument? @relation("DocDismissal", fields: [documentId], references: [id], onDelete: Cascade)
  /// Solo para documentos: el descarte muere si el documento cambia (FR-026).
  /// Para las otras dos fuentes es null y el descarte rige hasta que aparezca
  /// evidencia nueva (FR-026a).
  documentVersion Int?

  sectorId String
  sector   Sector @relation(fields: [sectorId], references: [id])

  dismissedById String
  dismissedBy   Employee @relation("ImprovementDismissedBy", fields: [dismissedById], references: [id])
  dismissedAt   DateTime @default(now())
  note          String?

  @@index([sectorId, source])
  @@index([documentId, documentVersion])
}
```

## Qué pasa con `CoverageThemeMark`

**Se conserva la tabla y se deja de escribir en ella.** FR-024b pide que lo ya marcado siga
valiendo; el filtro del descarte lee **las dos** — `ImprovementDismissal` y las marcas
viejas — al armar la lista (D6). No hay migración de datos: migrar filas de un modelo a
otro para un panel de pruebas es riesgo sin beneficio, y leer dos tablas al filtrar cuesta
una consulta más.

> [!WARNING]
> **Una marca vieja no filtra para siempre: filtra hasta que llegue tráfico nuevo.** Es la
> regla que la spec 009 ya implementa en `filterHandled` — un tema marcado **vuelve** si
> alguna de sus consultas es posterior a `markedAt`, que es lo que hace visible a un
> reincidente. Leer `CoverageThemeMark` como un booleano suprimiría esos temas para
> siempre y rompería FR-026a ("hasta que aparezca evidencia nueva") **en silencio**: nadie
> nota lo que no aparece.
>
> El descarte nuevo sobre un tema sigue el mismo criterio. Sobre un documento no: ahí la
> evidencia nueva es la versión (FR-026), no el tráfico.

El endpoint que marcaba/desmarcaba temas se retira junto con la pantalla (FR-001); su
reemplazo es el descarte unificado.

## Ítem para mejorar: no es una tabla

La lista se **arma al pedirla**, uniendo las tres fuentes y filtrando por descartes y por
lo ya entrevistado. No se persiste:

- Los temas de cobertura ya viven en `CoverageTheme` y cambian con cada corrida.
- Los escalados ya viven en `Escalation`.
- Los señalamientos ya viven en `DocumentFinding`.

Persistir un cuarto modelo que los copie crearía una fuente de verdad más que puede quedar
desincronizada de las tres que ya existen — el mismo error que la spec 009 evitó al no
guardar el área del tema y resolverla al armar la respuesta.

## Relaciones inversas en modelos existentes

| Modelo | Campo | Por qué |
|---|---|---|
| `Sector` | `documentReviews`, `dismissals` | El área revisada y los descartes de esa área |
| `Employee` | `docReviewsStarted`, `dismissalsMade` | Quién revisó y quién descartó |
| `KnowledgeDocument` | `findings`, `dismissals` | Los señalamientos y los descartes sobre él |
| `Escalation` | `dismissals` | Un caso descartado como fuente |

## Variables de entorno nuevas

| Variable | Default | Qué controla |
|---|---|---|
| `DOC_REVIEW_SEVERITY_CUT` | `80` | Corte de severidad (FR-016). Medido: deja ~12% del corpus; 75 dejaría 48% |
| `DOC_REVIEW_MAX_FINDINGS` | `10` | Tope de señalamientos mostrados por área (FR-016) |
| `IMPROVEMENT_MAX_ITEMS` | `15` | Tope de la lista completa, sumando las tres fuentes (SC-002) |

**Se reusa `COVERAGE_THEME_OVERLAP`** para reconocer un tema descartado entre corridas: es
la misma identidad por solape que la spec 009 ya definió y midió.
