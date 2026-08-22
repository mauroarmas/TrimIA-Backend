# Pre-spec 5 — Entrevista desde el tráfico real

**Sprint** 5B · **Orden** 5 de 5 · **Tareas del plan** 5B.11–5B.13 (RF11)
**Depende de** pre-spec 4 (de ahí salen las preguntas) y pre-spec 2 (ingesta con aviso) · **Estado** sin spec · **Spec** —
**Origen** planificada desde el Sprint 5B viejo; la conexión con el tráfico real sale de la futura del 2026-08-22

## Qué se quiere

La entrevista de capacitación por chat (RF11): el sistema le pregunta al responsable de
un área, y lo que responde se convierte en conocimiento con su aprobación.

**La diferencia con lo planificado originalmente**: las preguntas salen de lo que el
agente **realmente no pudo contestar** (pre-spec 4), no de un cuestionario a ciegas por
área. No *"contame sobre Logística"* sino *"estas 6 consultas sobre plazos de entrega
quedaron sin respuesta confiable, contame esto"*.

**Es la bisagra con el Sprint 5C**: de acá salen las píldoras de capacitación.

## Alcance

- **Entra:** `InterviewSession` (área, progreso, estado, respuestas, pausar/reanudar);
  el endpoint de conversación con preguntas derivadas del resumen de la pre-spec 4;
  y la ingesta al RAG con revisión y aprobación del supervisor.
- **No entra:** generar píldoras, audio ni simulación (Sprint 5C); la entrevista por
  **voz**, descartada en la revisión v5 del plan (§6.2, LiveKit).

## Lo que ya existe y hay que reusar

| Qué | Dónde | Para qué |
|---|---|---|
| Origen reservado en el modelo | `KnowledgeSourceType.ENTREVISTA` ([`schema.prisma:53`](../../prisma/schema.prisma#L53)) | Ya existe para marcar el conocimiento que venga de acá. `sourceId` apunta a `InterviewSession` según el comentario de la línea 589 |
| Resumen de lo que falta | Pre-spec 4 | **La fuente de las preguntas.** Sin eso la entrevista vuelve a ser a ciegas |
| Ingesta con aprobación | `knowledge-ai-edit.service.ts` (`preview`/`apply`), `escalations.service.ts` (`teachAgent`) | El patrón "la IA propone, la persona aprueba, recién ahí se guarda" ya está resuelto dos veces |
| Aviso de parecido al escribir | Pre-spec 2 | La entrevista es un **tercer camino de ingesta**: pasa por el mismo aviso |
| Escritura acotada por área | `KnowledgeService.assertPuedeEscribir` (spec 005) | Quien entrevista responde por sus áreas; lo que cargue queda en ellas |

## Decisiones al especificar

1. **Cuántas preguntas y con qué criterio se cierra.** El prototipo muestra "4/9", que
   supone un cuestionario de largo fijo. Si las preguntas salen del tráfico, el largo
   depende de cuánto falte — hay que elegir uno de los dos modelos.
2. **Qué pasa si el área no tiene huecos detectados.** Con poco tráfico la pre-spec 4
   no va a tener nada que decir, y la entrevista igual tiene que poder arrancar.
   Probablemente haga falta un modo de respaldo por área.
3. **Una sesión, ¿un área o varias?** Un gerente es responsable de las cinco.
4. **Granularidad de la aprobación.** ¿Se aprueba la entrevista entera o respuesta por
   respuesta? Lo segundo produce documentos más chicos y más específicos, que es mejor
   para el RAG y peor para la paciencia de quien aprueba.
5. **Qué se hace con una entrevista abandonada a la mitad.** Hay respuestas útiles
   adentro; tirarlas es caro y publicarlas sin cerrar es riesgoso.

## Riesgo principal

Es un **cuarto camino que fabrica documentos**, sumado a los tres que ya existen. Si
las preguntas no vienen filtradas por lo que ya está cubierto, la entrevista se
convierte en la máquina de duplicados más eficiente del sistema — justo lo que las
pre-specs 2 y 3 vienen a arreglar.

---

## Material de respaldo

### Estaba en el plan, pero era otra cosa

La entrevista figura en [`docs/plan_de_trabajo.md`](../../docs/plan_de_trabajo.md) desde
la revisión v5, en tres lugares:

| Dónde | Qué decía |
|---|---|
| Sprint 5B viejo, tareas 5B.1–5B.3 (RF11) | `InterviewSession`, `POST /interviews/message` con preguntas adaptativas de Gemini, ingesta al RAG con revisión del supervisor |
| Sprint 1, tabla de módulos por sector | El supervisor ve "…Base de Conocimiento + **Entrevistas** + Config" |
| §6.2 | Se descartó la entrevista **por voz** (LiveKit); queda por chat de texto |

El módulo `src/interviews/` **no existe** todavía. Lo único que ya está en el código es
el valor `ENTREVISTA` del enum de origen.

La entrevista planificada era *a ciegas*: Gemini generaba preguntas por área sin mirar
qué le preguntaron al agente ni dónde falló. Cambiarle la fuente de preguntas es lo que
la vuelve útil **y** lo que le da mejor materia prima al 5C.
