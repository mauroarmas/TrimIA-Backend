# Research & Architectural Decisions: Estructura de capacitación y generación de píldoras

**Feature**: `014-estructura-y-generacion-de-pildoras`
**Fecha**: 2026-10-04
**Estado**: Completado

---

## 1. Decisiones de Diseño y Arquitectura

### Decisión 1: Modelado de las Preguntas de Autoevaluación (`quiz`)
- **Decisión**: Almacenar las preguntas de autoevaluación como un campo estructurado `quiz Json` dentro de la tabla `Pill`, en lugar de crear una tabla relacional separada `QuizQuestion`.
- **Racional**: La especificación y el requisito RF05 fijan exactamente 2 preguntas de autoevaluación por píldora. Estas preguntas no se comparten ni se reasignan entre píldoras; son parte indivisible del contenido didáctico de la lección. Almacenarlas como JSON en Postgres permite recuperarlas en la misma consulta sin JOINs adicionales, simplifica el versionado atómico y mantiene la estructura liviana.
- **Esquema de la estructura en JSON**:
  ```json
  [
    {
      "id": 1,
      "question": "¿Cuál es el primer paso ante un comprobante ilegible?",
      "options": ["Aprobar el pago igual", "Rechazar sin aviso", "Solicitar reenvío al cliente indicando el motivo"],
      "correctOptionIndex": 2,
      "explanation": "Siempre se debe pedir una foto más nítida antes de escalar o rechazar."
    }
  ]
  ```
- **Alternativas descartadas**:
  - *Tabla relacional `QuizQuestion`*: Descartada por sobreingeniería. Para una relación fija de 2 preguntas subordinadas a la píldora, introducir una tabla extra y claves foráneas añade complejidad de migraciones y consultas sin aportar valor de búsqueda ni reutilización.

---

### Decisión 2: Generación Estructurada con Gemini Structured Output
- **Decisión**: Utilizar la API oficial de `GoogleGenerativeAI` configurando `responseSchema` (JSON schema estricto) utilizando el modelo estándar del proyecto (`GEMINI_MODEL`, hoy `gemini-3.5-flash-lite`).
- **Racional**: Garantiza que el LLM devuelva siempre el 100% de los campos obligatorios (título, objetivo, pasos 1..N y las 2 preguntas con explicaciones), eliminando errores de parsing y fallos de formato. Este mismo patrón se utiliza con éxito en `knowledge-ai-edit.service.ts` y en el clasificador de intenciones.
- **Prompting y contexto RAG**:
  - Se recuperan los 4 fragmentos más relevantes del corpus para el tema consultado vía `KnowledgeService.search()` (filtrado por la audiencia `INTERNO` y el agente del sector).
  - Si el sector cuenta con sesiones de entrevista del Sprint 5B (`InterviewSession`), se agregan las respuestas del supervisor sobre procedimientos del sector como contexto complementario.
  - Si la confianza del contexto recuperado es nula o menor al umbral de seguridad, el servicio aborta la generación con un mensaje claro en lugar de alucinar (Principio II).

---

### Decisión 3: Autorización por Sector y Gobernanza
- **Decisión**: Aplicar la regla de sector utilizando `Sector.agentType` y validando la autoría mediante `KnowledgeService.assertPuedeEscribir(userId, sector.agentType)`.
- **Racional**: El Principio I de la Constitución manda explícitamente: *"Si entra el rol, se extienden los puntos existentes y ninguno nuevo. Si aparece un tercer lugar que decide acceso, se rompió el principio no negociable"*. Al usar `assertPuedeEscribir`, garantizamos que:
  - Diego (supervisor de todas las áreas) puede crear y publicar en cualquier módulo.
  - Silvia (Cobranzas) solo puede crear y publicar en Cobranzas.
  - Los módulos transversales `GENERAL` solo pueden ser gestionados por quien supervisa todas las áreas.
  - La autoría se extrae del token JWT (`req.user.id`).
- **Alternativas descartadas**:
  - *Crear un nuevo Guard o tabla de permisos ad-hoc*: Descartado por violar directamente la Constitución (Principio I).

---

### Decisión 4: Ingesta Opcional en el Corpus RAG al Publicar
- **Decisión**: Al aprobar y publicar una píldora (`POST /training/pills/:id/publish`), el supervisor puede enviar la bandera opcional `indexInKnowledge: boolean`. Si es `true`, el servicio invoca internamente `KnowledgeService.createDocument()`.
- **Racional**: El Sprint 5C alimenta la base de conocimiento con las píldoras aprobadas. Al usar el método estándar `createDocument()`, la píldora pasa automáticamente por el detector de duplicados exactos (`buscarDuplicadoExacto`, spec 007) y por la sanitización de embeddings (spec 006), evitando ensuciar el corpus con duplicados.

---

### Decisión 5: Desbloqueo Secuencial de Píldoras para el Empleado
- **Decisión**: El desbloqueo secuencial se calcula dinámicamente en la consulta del módulo a partir de los `orderIndex` de las píldoras y de los registros existentes en `EmployeeProgress`.
- **Racional**: Una píldora con `orderIndex > 0` está desbloqueada si la píldora con `orderIndex - 1` del mismo módulo tiene un registro en `EmployeeProgress` con `status === 'COMPLETED'`. Si no, se devuelve marcada como `locked: true` para el empleado. Esto evita triggers o jobs batch y mantiene la lógica determinística y testeable.

---

## 2. Resumen de Tecnologías y Librerías

- **NestJS 11 + TypeScript 5.x**: Módulo `src/training/`.
- **Prisma + PostgreSQL**: Modelos `TrainingModule`, `Pill`, `EmployeeProgress`.
- **Gemini (`@google/genai` o `@google/generative-ai`)**: Generación con schema estructurado.
- **Jest**: Pruebas unitarias para controladores, servicios y verificador de permisos.
