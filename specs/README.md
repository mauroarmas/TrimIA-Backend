# Specs — estado del producto

Una carpeta por feature, con el flujo de GitHub Spec Kit
(`/speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement`).
Este archivo es el índice: qué aporta cada spec, en qué estado está y qué le
cambió alguna spec posterior.

Las reglas de producto viven en [`.specify/memory/constitution.md`](../.specify/memory/constitution.md);
el plan por sprints, en [`docs/plan_de_trabajo.md`](../docs/plan_de_trabajo.md).

**Estados**: ✅ implementada y probada · 📝 especificada, sin implementar.

---

## Índice

| # | Nombre | Qué aporta | Estado | Rama |
|---|--------|------------|--------|------|
| **000** | [Línea base pre-Spec-Kit](000-linea-base/) | Núcleo conversacional (orquestador con ruteo sticky + 5 agentes RAG + memoria), auth JWT con whitelist y sectores, y Panel del Supervisor (conversaciones, eventos, estado de agentes). Fases 1-4 + Sprints 1-3. | ✅ **As-built**: escrita el 2026-08-11 *después* de estar implementada y en uso, para dejar registro antes de mostrar el proyecto al tutor. No siguió el flujo de Spec Kit y no tiene `plan.md`/`tasks.md`. → **Modificada por [005](005-roles-y-areas/)**: hoy el orquestador solo recibe `userType` (`EMPLEADO`/`CLIENTE`) y un empleado pertenece a un único sector; la 005 le agrega rol y áreas. → **Modificada por [004](004-chat-tiempo-real/)** en un punto acotado: el panel deja de usar el webhook de WhatsApp con el secreto compartido para simular (el webhook real lo sigue exigiendo). | sin rama propia — el código llegó por las ramas históricas (`basicArqInf`, `ragSystem`, `auth`, `orchesterAgentModule`, `messagingModule`, `refactor/*`) y vive en `dev` |
| **001** | [Human-in-the-loop](001-human-in-the-loop/) | Escalado real: cola de casos pendientes con motivo y contexto, `takeover`/`release`/`reply`, delegar un caso a otro responsable, "responder y enseñar a la IA" (la respuesta del supervisor se ingesta al RAG) y notas internas (`InternalNote`). Sprint 3. | ✅ Implementada (Sprint 3 ✅ en `plan_de_trabajo.md`). Su `research.md` **descartó** reactivar el checkpointer de LangGraph que pedía el input original: se resolvió con estado en Postgres y el checkpointer quedó postergado al Sprint 7. → **Modificada por [003](003-archivos-chat-conocimiento/)**: completa "Responder Consulta" con propuesta redactada por Gemini y separa aprobar-y-enviar / aprobar-y-guardar / descartar (`DISCARDED` en `EscalationStatus`). → **Modificada por [005](005-roles-y-areas/)**: a un supervisor o gerente deja de creársele una escalación, y guardar la respuesta como conocimiento queda acotado a sus áreas. | `human-in-the-loop` (el encabezado del spec dice `001-human-in-the-loop`, que nunca existió) |
| **002** | [Cobranzas — comprobantes, recordatorios y verificación](002-collections-payments/) | Modelos `Client`/`Quota`/`PaymentProof`, lectura tentativa del comprobante con Gemini Vision (sugerencia, nunca verdad del sistema), recordatorios BullMQ a 7/3/0 días, pantalla del Cobrador Controlador para el impacto bancario, panel de cobranzas con KPIs y timeline de actividad. Sprint 4. | ✅ Implementada el 2026-08-05 (128 tests). **Extiende** a [001](001-human-in-the-loop/) sin modificarla: reusa `Escalation`, `takeover`/`reply` e `InternalNote`. Bloqueante externo que sigue abierto: la aprobación de plantillas HSM por Meta. | `sprint-4-cobranzas` |
| **003** | [Archivos, chat web y base de conocimiento](003-archivos-chat-conocimiento/) | Pipeline de archivos en `POST /knowledge` (PDF, Word, imágenes, audio), audio de WhatsApp transcripto, chat web en el panel, CRUD completo de la base de conocimiento con reindexado en ChromaDB, "editar con la IA" con aprobación explícita, trazabilidad de origen e indicador de recuperación. Sprint 5A. | ✅ Implementada el 2026-08-18 (109/109 tareas, 402 tests), incluida su fase de panel en `trimIA-frontend`. → **Modifica a [001](001-human-in-the-loop/)** (ver ahí). → **Modificada por [004](004-chat-tiempo-real/)**: el chat web que entrega acá funcionaba por polling cada 2 s y pasa a entrega en vivo; `GET /messaging/web/:convId/messages` sobrevive como historial. → **Modificada por [005](005-roles-y-areas/)**: el CRUD de conocimiento pasa a permitir escribir solo en las áreas propias (ver es libre). | `sprint-5a-archivos-chat-conocimiento` |
| **004** | [Chats del panel en tiempo real](004-chat-tiempo-real/) | Los dos chats del panel dejan de preguntar en bucle: entrega en vivo, la respuesta escrita a mano por un supervisor llega al chat abierto, reanudación con cursor `after` sin pérdidas ni duplicados, aviso visible cuando un turno agota sus reintentos, y `POST /messaging/simulate` con sesión `SUPERVISOR` en vez del secreto de producción. Habilitador del Sprint 5B. | ✅ Implementada el 2026-08-18 (62/62 tareas, backend + panel). El transporte se decidió en su `research.md`, que **descarta mantener el polling** con evidencia. → **Modifica a [003](003-archivos-chat-conocimiento/) y a [000](000-linea-base/)** (ver ahí). | `004-chat-tiempo-real` |
| **005** | [El asistente sabe con quién habla](005-roles-y-areas/) | El rol y las áreas viajan hasta el asistente: reconoce cuatro interlocutores (cliente, empleado, supervisor, gerente) y les habla distinto; una persona puede ser responsable de varias áreas (N:M) y quien lo es de todas es gerente; ante baja confianza a un responsable no se le abre un caso a sí mismo sino que se le muestra qué documentos se consultaron y con cuánta cercanía; derivar a otra persona; y escribir conocimiento solo en las áreas propias. Sprint 5B. | 📝 **Especificada, sin implementar**: `spec.md`, `plan.md` y las 50 tareas están; 0 ejecutadas. Nace de los hallazgos del 2026-08-18 probando el panel ([docs/hallazgos-para-proxima-spec.md](../docs/hallazgos-para-proxima-spec.md)). → **Modifica a [000](000-linea-base/), [001](001-human-in-the-loop/) y [003](003-archivos-chat-conocimiento/)** (ver ahí). No toca la recuperación del RAG ni lo que alcanza un cliente. | `005-roles-y-areas` ← nace de `004-chat-tiempo-real` |

---

## Cómo leer el estado de una spec

Tres advertencias que ahorran un diagnóstico equivocado:

1. **Los tildes de `tasks.md` no son la fuente de verdad para 001 y 002.** Las dos
   están implementadas y testeadas, pero sus checkboxes quedaron sin mantener
   (0/32 y 8/55). La convención de tildar al cerrar recién se sostuvo desde la 003.
   Para el estado real: `docs/plan_de_trabajo.md` §8 y el código en `src/`.
2. **La fase final de panel de cada spec vive en otro repositorio.** Toda spec que
   agrega endpoints termina con una fase de tareas sobre
   `/home/mauro/Proyectos/trimIA-frontend`, y esas rutas son relativas a ese repo.
   Las de 003 y 004 ya están hechas allá (commits `b256cd5`…`b684974`); la nota de
   `plan_de_trabajo.md` §8 que dice que el panel todavía no consume el 5A quedó
   desactualizada.
3. **Ninguna rama de feature está mergeada a `main`.** `main` quedó en 2026-05-23;
   el trabajo se encadena rama sobre rama (`sprint-5a-…` → `004-…` → `005-…`).

## Cadena de dependencias

```text
000 línea base ──► 001 human-in-the-loop ──► 002 cobranzas (reusa 001)
                        │
                        └──► 003 archivos + chat web + KB ──► 004 tiempo real
                                                                   │
        005 roles y áreas ◄────────────────────────────────────────┘
        (modifica 000, 001 y 003)
```
