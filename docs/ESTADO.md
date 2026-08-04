# Estado del Proyecto — TrimIA Backend

> Snapshot al **2026-05-23**. Sirve como red de seguridad para retomar el contexto
> (por ejemplo tras migrar de máquina). Para el detalle técnico completo ver
> `docs/ArquitecturaFLujoTrabajo.md`.

## Qué es

Backend NestJS de **TrimIA**, tesis de grado. Plataforma de agentes IA para la empresa
comercial **Credimisión S.R.L.** (venta de productos al contado y financiados en Misiones).
Atiende clientes por WhatsApp y **capacita a los empleados** sobre procesos de negocio,
con arquitectura RAG.

## Stack

NestJS + TypeScript · Prisma + PostgreSQL · Redis + BullMQ · LangGraph + Gemini
(`gemini-3.1-flash-lite`) · ChromaDB (RAG) · n8n (WhatsApp) · Docker Compose.

## Modelo de agentes (5 + orquestador)

| Agente | Rol | Sistemas externos |
|--------|-----|-------------------|
| ORCHESTRATOR | Clasifica y deriva cada mensaje | — |
| SALES | Conversación comercial, prospectos, seguimiento | CRM |
| ADMIN | Crédito y aprobación de financiación | **Riesgo Online (exclusivo)**, Paljet |
| COLLECTIONS | Cobro de cuotas ya financiadas | Paljet, Drive |
| LOGISTICS | Envíos, entregas, despacho | Paljet |
| DEPOSITS | Stock, disponibilidad, fotos | Paljet |

- **Doble rol:** cada agente atiende clientes Y capacita empleados.
- **SALES** no decide crédito ni cierra venta: deriva a ADMIN y al humano (con la info ya recopilada).
- **ADMIN** es el más auditable; aísla las decisiones de crédito.
- **Confidencialidad (pendiente Fase 4):** distinguir cliente/empleado (whitelist + `userType`)
  y etiquetar el conocimiento por audiencia (`público`/`interno`) para filtrar el RAG.

## Progreso por fases

| Fase | Estado | Qué incluye |
|------|--------|-------------|
| **1 — Infraestructura** | ✅ Completa | Docker, Prisma, Redis, Checkpointer (PostgresSaver), Health, logging pino |
| **2 — Comunicación** | ✅ Completa | Webhook n8n + N8nAuthGuard + Throttle, BullMQ (concurrency 1), ConversationsService, WhatsappSender |
| **3 — Core IA** | ✅ Completa | Orquestador LangGraph (classify_intent + routing), 5 agentes **stub**, logging (OrchestrationEvent + TokenUsage), enchufado al MessageProcessor |
| **4 — RAG** | ⏳ Pendiente | ChromaDB + embeddings + KnowledgeModule + agentes reales (retrieve_context, evaluate_confidence, escalate_to_human) + confidencialidad |
| **5 — Integraciones** | ⏳ Pendiente | Paljet, Riesgo Online (ADMIN), CRM como DynamicStructuredTool |
| **6 — Admin/Gobernanza** | ⏳ Pendiente | Endpoints de Paperclip, human-in-the-loop completo, métricas |

## Qué funciona hoy (end-to-end)

```
WhatsApp/Postman → n8n (Workflow A) → POST /messaging/webhook → BullMQ
  → MessageProcessor → orquestador (classify → agente stub → log_event → track_tokens)
  → respuesta → WhatsappSender → n8n (Workflow B, visible en Executions)
```

- Los agentes responden **texto fijo (stub)** — todavía no tienen RAG ni tools.
- Cada mensaje deja `OrchestrationEvent` (auditoría) y `TokenUsage` (tokens + latencia) en Postgres.

## Decisiones / notas importantes

- **Memoria en dos capas:** Prisma = negocio (Conversation, Message, etc.); PostgresSaver = estado interno de LangGraph (tablas `checkpoints*`, no tocar con Prisma).
- **`prisma db push`** en dev (no `migrate reset`, que choca con las tablas del checkpointer).
- **Docker en Windows:** el `--watch` a veces no recompila (eventos de FS no cruzan el bind mount) → reiniciar el contenedor. En Linux debería andar mejor.
- **Tras agregar paquetes:** `npm install` (actualiza lockfile) + `docker compose up -d --build -V nestjs` (el `-V` recrea el volumen anónimo de node_modules).
- **Debug:** `POST /orchestrator/classify` permite probar el orquestador sin pasar por la cola (controller temporal de desarrollo).

## Pendientes anotados

- Clasificación tarda **~11s** consistentemente (no es cold start). Revisar al optimizar (¿structured output con flash-lite? ¿latencia de red?).
- Decidir si el debug controller se registra solo en `NODE_ENV !== 'production'`.
- WhatsApp real: falta configurar número de prueba de Meta (Phone Number ID + token) en el Workflow B. Por ahora se valida vía Executions de n8n.
- Revisar si Paljet necesita escritura (carga de pagos en cobranzas) o queda solo lectura.

## Próximo paso

Arrancar la **Fase 4 (RAG)**: ChromaDB + embeddings + KnowledgeModule, y reemplazar los
nodos stub de los agentes por el flujo real (retrieve_context → evaluate_confidence →
generate_response / escalate_to_human).
