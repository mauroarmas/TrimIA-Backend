# Implementation Plan: Chats del panel en tiempo real

**Branch**: `004-chat-tiempo-real` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-chat-tiempo-real/spec.md`

**Spike previo**: [research.md](./research.md) — decidió el transporte (SSE) antes
de escribir un requisito. Este plan lo continúa; no lo reabre.

## Summary

Los dos chats del panel dejan de preguntar en bucle y pasan a recibir los
mensajes cuando quedan registrados. El transporte es **SSE (`text/event-stream`)
consumido con `fetch`**, con **fan-out por Redis pub/sub** para que funcione con
más de una instancia, y **dos puntos de emisión únicos** dentro de
`ConversationsService`: `addMessage()` para los mensajes y
`setStatus()`/`takeover()`/`release()` para los cambios de estado.

Tres cosas que no son transporte y entran igual, porque el spike las encontró
como defectos de corrección (no de latencia):

1. `replyManually()` deja de escribir Prisma por su cuenta y pasa por
   `addMessage()`, para que **la respuesta de un supervisor llegue** (hoy no
   llega nunca).
2. El `FALLBACK` de un turno que agota sus reintentos **se persiste**, para que
   un turno no termine en silencio en el panel.
3. El simulador recibe **puerta propia con JWT + rol `SUPERVISOR`** y se retira
   el secreto compartido de producción de la interfaz.

Cero dependencias nuevas: `@Sse()` viene en `@nestjs/common`, `rxjs` e `ioredis`
ya están instalados.

## Technical Context

**Language/Version**: TypeScript 5.x + Node.js 20, NestJS 11

**Primary Dependencies**: `@nestjs/common` (`@Sse()`), `rxjs` ^7.8.1 e `ioredis`
^5.6.1 — **las tres ya instaladas**. BullMQ ^5 y Prisma ^6 sin cambios.
**Ninguna dependencia nueva, en backend ni en frontend.**

**Storage**: PostgreSQL + Prisma. **Sin cambios de schema**: `Conversation` y
`Message` ya tienen todo lo que la entrega necesita (`id`, `role`, `content`,
`agentType`, `createdAt`, `status`). Redis se usa como **bus de eventos**, no
como almacén: el registro en Postgres sigue siendo la única fuente de verdad
(RF-007).

**Testing**: Jest, `*.spec.ts` junto al código. Cubren autorización de los
streams, reanudación, resolución del remitente simulado y el aviso de fracaso.

**Target Platform**: Docker Compose (dev, una instancia). Cloud Run previsto para
Sprint 8 (varias instancias) — el diseño no lo impide, verificarlo es de ese
sprint.

**Project Type**: Servicio web (backend NestJS) + panel de pruebas React
(`trimIA-frontend`, repo hermano, sin tests por decisión).

**Performance Goals**: SC-001 respuesta visible en < 2 s desde que se registra ·
SC-010 acuse del envío < 1 s · SC-008 ~0 peticiones/min por chat en reposo (hoy
30) · SC-004 sesión de 45 min sostenida.

**Constraints**:
- **Principio IV**: el request no ejecuta IA. El `POST` sigue encolando y
  respondiendo `202`; el stream es de solo lectura y nunca dispara trabajo.
- **Principio I**: la autorización no se replica. Cada stream vive detrás de los
  guards que **ya** gobiernan su superficie (ver Decisión D1 en `research.md §9`).
- Sin dependencias nuevas y sin cambios de schema.

**Scale/Scope**: uso interno; decenas de empleados, no miles. Dos endpoints de
stream, un `POST` nuevo (simulador), un módulo nuevo (`RealtimeModule`), una
variable de entorno nueva (`SSE_HEARTBEAT_MS`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Veredicto | Cómo lo cumple este diseño |
|---|---|---|
| **I. Confidencialidad por rol y audiencia** (NO NEGOCIABLE) | ✅ PASA | El stream del chat propio reusa **verbatim** el chequeo de pertenencia por teléfono normalizado que hoy da el `403` ([messaging-web.controller.ts:74-83](../../src/messaging/messaging-web.controller.ts#L74-L83)); el del simulador vive detrás de `@Roles('SUPERVISOR')`, el mismo guard del resto del panel. **No se escribe ninguna regla de autorización nueva.** `allowedAgentsFor()` y la audiencia en `knowledge.search()` no se tocan: el transporte no participa de esa decisión. |
| **II. RAG estricto** | ✅ N/A | No se toca ningún grafo de agente, prompt, umbral ni recuperación. Cambia cuándo se ve la respuesta, no cómo se produce. |
| **III. Humano en el loop** | ✅ PASA | Refuerza el principio: hace que la respuesta escrita por un `SUPERVISOR` **llegue** a la otra persona, que hoy es exactamente lo que falla. No automatiza ninguna decisión. |
| **IV. Procesamiento asíncrono y resiliente** | ✅ PASA | El `POST` sigue validando, encolando y devolviendo `202`; el trabajo sigue en `MessageProcessor` con sus 3 intentos. El stream **no produce** nada, solo entrega lo ya registrado. La puerta del simulador reusa `MessagingService.enqueue()`, el mismo camino del webhook. |
| **V. Arquitectura modular y desacoplada** | ✅ PASA | `RealtimeModule` es un módulo propio con un servicio (`RealtimeService`), siguiendo el patrón ya establecido en el proyecto de extraer a módulo chico para no acoplar ni generar ciclos (`WhatsappSenderModule`, `OrchestrationLoggerModule`). DI siempre; la lógica no vive en los controladores. |
| **Stack fijo** | ✅ PASA | No sustituye ni agrega nada al stack: Redis y NestJS ya están. |
| **Env vars con Joi + `.env.example`** | ⚠️ OBLIGA | `SSE_HEARTBEAT_MS` **debe** validarse en `config.module.ts` y documentarse en `.env.example`. Es una tarea, no una excepción. |
| **Tests obligatorios** | ⚠️ OBLIGA | Toda la autorización nueva de los streams y la puerta del simulador van con `*.spec.ts`. El panel no lleva tests (banco de pruebas). |
| **Trazabilidad** | ✅ PASA | Entregable **E4** (Panel), objetivos **OE-10** (confidencialidad) y **OE-11** (auditoría); habilitador del Sprint 5B. |
| **Cierre de spec: tareas de panel** | ⏳ PENDIENTE | Se cumple en `/speckit-tasks`: la última fase de `tasks.md` enumera el trabajo de `trimIA-frontend`, **sin implementarlo**. |

**Resultado del gate: PASA.** Sin violaciones que justificar → la sección
*Complexity Tracking* se elimina.

## Project Structure

### Documentation (this feature)

```text
specs/004-chat-tiempo-real/
├── spec.md              # Qué se observa (revisada, commit 00affe4/e3a4ecf)
├── research.md          # Spike de transporte (§1-§8) + decisiones de diseño (§9)
├── plan.md              # Este archivo
├── data-model.md        # Entidades y contrato de eventos
├── quickstart.md        # Cómo validarlo a mano, de punta a punta
├── contracts/
│   ├── sse-events.md            # Contrato de los eventos que viajan
│   ├── messaging-web-stream.md  # GET /messaging/web/:convId/stream
│   ├── supervisor-stream.md     # GET /supervisor/conversations/:id/stream
│   └── messaging-simulate.md    # POST /messaging/simulate
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks — NO lo crea este comando
```

### Source Code (repository root)

```text
src/
├── realtime/                          # NUEVO — el bus, aislado en su propio módulo
│   ├── realtime.module.ts
│   ├── realtime.service.ts            # publish() / streamFor() sobre Redis pub/sub
│   ├── realtime.service.spec.ts       # fan-out, refcount de suscripción, cierre
│   └── realtime.types.ts              # tipos del evento (contrato compartido)
├── conversations/
│   ├── conversations.service.ts       # MODIFICADO — emite en addMessage/setStatus/
│   │                                  # takeover/release; replyManually pasa por addMessage
│   ├── conversations.service.spec.ts  # MODIFICADO — un mensaje ⇒ exactamente un evento
│   └── conversations.module.ts        # MODIFICADO — importa RealtimeModule
├── messaging/
│   ├── messaging-web.controller.ts    # MODIFICADO — + GET :convId/stream (@Sse)
│   ├── messaging-web.controller.spec.ts # MODIFICADO — 401/403/200 del stream
│   ├── messaging-simulate.controller.ts # NUEVO — POST /messaging/simulate (SUPERVISOR)
│   ├── messaging-simulate.controller.spec.ts # NUEVO — rol, y teléfono libre
│   └── dto/simulate-message.dto.ts    # NUEVO
├── supervisor/
│   ├── supervisor.controller.ts       # MODIFICADO — + GET conversations/:id/stream
│   └── supervisor.controller.spec.ts  # MODIFICADO — @Roles('SUPERVISOR') en el stream
├── queue/processors/
│   ├── message.processor.ts           # MODIFICADO — persiste el FALLBACK (RF-012)
│   └── message.processor.spec.ts      # MODIFICADO — turno fallido deja mensaje visible
└── common/config/config.module.ts     # MODIFICADO — Joi para SSE_HEARTBEAT_MS

.env.example                           # MODIFICADO — documenta SSE_HEARTBEAT_MS
```

Y en el repo hermano `trimIA-frontend` (**tareas enumeradas, no implementadas
acá** — regla de cierre de spec):

```text
src/
├── api.js                    # + openConversationStream() sobre fetch, reusando headers
├── components/
│   ├── WebChat.jsx           # polling → stream; sin tope de intentos
│   └── ChatSimulator.jsx     # stream + puerta nueva; se elimina el campo de secreto
```

**Structure Decision**: proyecto único NestJS (no monorepo): el backend vive en
`src/` con un módulo por dominio, y el panel de pruebas es un repo hermano
independiente. El bus va a `src/realtime/` como módulo propio en vez de dentro de
`conversations/`, por dos razones concretas: lo consumen tres módulos distintos
(`ConversationsModule` publica; `MessagingModule` y `SupervisorModule` sirven
streams), y aislarlo evita el ciclo que aparecería si `ConversationsModule`
dependiera de quien sirve los streams. Es el mismo patrón que el proyecto ya usa
en `WhatsappSenderModule` y `OrchestrationLoggerModule`.

## Constitution Re-Check (post-diseño de Fase 1)

Re-evaluado después de escribir `data-model.md`, `contracts/` y `quickstart.md`.

**Resultado: sigue pasando.** El diseño no introdujo ninguna violación, y en dos
puntos el gate obligó a decidir mejor de lo que se había planteado:

1. **Principio I salió reforzado, no solo respetado.** Al escribir el contrato
   apareció algo que no estaba a la vista: `listMessages()` devuelve **solo** los
   roles `USER` y `ASSISTANT`. Si el stream emitiera también `TOOL` y `SYSTEM`,
   la entrega en tiempo real mostraría mensajes que el historial no muestra —una
   fuga contra RF-015, y encima inconsistente, porque al recargar la página
   desaparecerían. El contrato ahora fija el mismo filtro para las dos vías
   ([data-model.md](./data-model.md) §1).
2. **Apareció un riesgo de seguridad propio del simulador.** El endpoint **no**
   acepta `channel` por parámetro y fuerza `WEB`. Si lo aceptara, un supervisor
   escribiendo un teléfono cualquiera le mandaría un WhatsApp real a un
   desconocido, porque el corte que evita el envío existe solo para canales
   distintos de WhatsApp. Queda fijado en
   [contracts/messaging-simulate.md](./contracts/messaging-simulate.md).

Dos obligaciones que el gate deja abiertas y que `tasks.md` tiene que recoger:

- `SSE_HEARTBEAT_MS` **debe** validarse con Joi en `config.module.ts` y
  documentarse en `.env.example`. No es opcional.
- **Cambio de contrato a declarar**: persistir el aviso de fracaso afecta también
  a WhatsApp, donde hoy la disculpa se envía pero no queda registrada. Es lo
  correcto (auditoría, OE-11) pero no es invisible — fundamento en
  [research.md §13](./research.md).

**Complexity Tracking**: no aplica. Sin violaciones que justificar.
