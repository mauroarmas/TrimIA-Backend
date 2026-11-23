<div align="center">

# TrimIA — Backend

**Plataforma multi-agente de IA con RAG, Human-in-the-Loop y automatización comercial sobre WhatsApp y Web**

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph.js-Multi--Agent-1C3C3C?style=for-the-badge)](https://langchain-ai.github.io/langgraphjs/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-LLM_%2B_Vision_%2B_TTS-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_%2B_Prisma-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis_%2B_BullMQ-Async_Queues-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://docs.bullmq.io/)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-Vector_RAG-FF6B35?style=for-the-badge)](https://www.trychroma.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

[Arquitectura](#-arquitectura-del-sistema) · [Capacidades Clave](#-capacidades-clave) · [Clone & Run (Devs e IA)](#-guía-de-arranque-rápido-devs-y-agentes-de-ia) · [Testing & CI](#-testing-y-verificación) · [Repositorio Frontend](https://github.com/mauroarmas/trimia-frontend)

</div>

---

## 🎯 Sobre el proyecto

**TrimIA** es una plataforma empresarial de agentes de inteligencia artificial diseñada para **Credimisión S.R.L.** (comercio minorista con venta financiada propia), desarrollada como Proyecto Final de Ingeniería en Sistemas.

Resuelve el ciclo operativo completo de atención y gestión comercial combinando **orquestación multi-agente (LangGraph + Google Gemini)**, **búsqueda semántica controlada por audiencia (RAG con ChromaDB)**, **supervisión humana obligatoria en decisiones críticas (Human-in-the-Loop)** y un **módulo de capacitación corporativa con diagnóstico, píldoras en audio TTS y simulaciones de roleplay**.

> **Repositorio hermano (Panel Web React):** [mauroarmas/trimia-frontend](https://github.com/mauroarmas/trimia-frontend)

---

## ✨ Capacidades clave

| Dominio | Qué resuelve en producción |
|---|---|
| **Orquestación Multi-Agente (LangGraph)** | Enrutamiento sticky con 5 agentes especializados (`SALES`, `ADMIN`, `COLLECTIONS`, `LOGISTICS`, `DEPOSITS`). Aislamiento estricto por perfil: clientes externos solo acceden a Ventas y Cobranzas; empleados acceden a los 5 agentes internos. |
| **RAG Confiable y Gobernanza de Conocimiento** | Ingesta multimodal (texto, PDF, DOCX, imágenes y audio), separación de audiencias (`PUBLICO` vs `INTERNO`), umbrales de confianza calibrados por entorno, detección de duplicados, barridos de higiene/fusión, análisis de brechas de cobertura y entrevistas asistidas para cerrar huecos del corpus. |
| **Human-in-the-Loop (HITL)** | Ante baja confianza o decisiones sensibles, el agente escala automáticamente a la cola por área. El supervisor puede tomar el hilo (`takeover`), recibir borradores sugeridos por IA, responder, **enseñar/corregir la base de conocimiento** en el acto y devolver la conversación al bot. |
| **Venta Financiada y Seguimiento Comercial** | Flujo transaccional con estado persistido, control optimista de concurrencia (CAS), revisión administrativa obligatoria, sincronización resiliente con CRM (Google Sheets vía n8n), preferencias de no contacto (`opt-out`) y outbox duradero (`OutboundCommunication`) con reintentos acotados. |
| **Cobranzas y Verificación de Comprobantes** | Lectura asistida de comprobantes con Gemini Vision (como sugerencia, nunca verdad automática), circuito de verificación de impacto bancario por Cobrador Controlador y recordatorios programados con BullMQ. |
| **Capacitación Corporativa con IA** | Diagnóstico inicial por área, generación de píldoras de estudio, síntesis de audio a dos voces (TTS + `ffmpeg`/`ffprobe`) y simulaciones conversacionales guiadas con feedback evaluado. |
| **Arquitectura Asíncrona y Tiempo Real** | Los webhooks de WhatsApp (vía n8n) validan, encolan en Redis/BullMQ y responden `202 Accepted` sin bloquear requests. El panel web recibe mensajes y eventos en vivo mediante **Server-Sent Events (SSE)** con reanudación por cursor. |

---

## 🏛️ Arquitectura del sistema

```mermaid
flowchart LR
    WA["WhatsApp Business<br/>(Meta API)"] --> N8N["n8n<br/>Webhooks, Media & CRM"]
    WEB["Panel Web React<br/>(trimia-frontend)"] -->|JWT + REST / SSE| API["NestJS 11 API<br/>Validation · RBAC · Swagger"]
    N8N -->|x-n8n-secret| API

    API -->|202 Enqueue| REDIS[("Redis + BullMQ<br/>Colas y Workers")]
    REDIS --> WORKER["Message & Domain<br/>Processors"]

    WORKER --> ORCH["Orquestador LangGraph<br/>Routing + Políticas"]
    ORCH --> AGENTS["5 Agentes RAG<br/>Sales · Admin · Collections<br/>Logistics · Deposits"]

    AGENTS <--> GEMINI["Google Gemini<br/>LLM · Embeddings · Vision · TTS"]
    AGENTS <--> CHROMA[("ChromaDB<br/>Vectores RAG")]
    WORKER <--> PG[("PostgreSQL 16<br/>Prisma ORM")]
    API <--> PG
    API -->|SSE Stream| WEB
    WORKER -->|Envío / CRM Sync| N8N
```

### Flujo común de agentes (`buildRagAgentGraph`)

Todos los agentes especializados comparten una fábrica auditable (`src/ai/agents/shared/rag-agent.graph.ts`):

```text
retrieve_context (ChromaDB + filtro de audiencia)
  └─► evaluate_confidence (score >= RAG_CONFIDENCE_THRESHOLD)
        ├── Confianza suficiente ──► generate_response (Gemini)
        └── Baja confianza / política ──► escalate_to_human (Cola HITL por área)
```

### Reglas de ingeniería y seguridad

- **Confidencialidad centralizada:** La autorización de agentes por tipo de usuario vive únicamente en `allowedAgentsFor()` (`src/ai/agents/agent-domains.ts`) y la audiencia RAG (`INTERNO`/`PUBLICO`) se aplica en `KnowledgeService.search()`.
- **Cero decisiones financieras autónomas:** Verificación de pagos, dictamen crediticio y cierre de ventas financiadas siempre requieren aprobación humana (`SUPERVISOR` / `ADMIN` / `Cobrador Controlador`).
- **Configuración estricta:** Todas las variables de entorno, modelos (`GEMINI_MODEL`, `EMBEDDING_MODEL`) y umbrales se validan al inicio con **Joi** (`src/common/config/config.module.ts`).
- **Privacidad de notas de voz:** En el perfil base de `docker-compose.yml`, n8n procesa audios en memoria sin persistir binarios ni payloads en disco.

---

## 🛠️ Stack tecnológico

| Capa | Tecnología |
|---|---|
| **Backend & API** | NestJS 11, TypeScript 5, Express, Swagger/OpenAPI, `nestjs-pino`, `@nestjs/throttler`, Joi |
| **IA & Orquestación** | LangGraph.js (`@langchain/langgraph`), `@langchain/google-genai`, Google Gemini (LLM, Embeddings, Vision, TTS) |
| **Bases de datos & Vectores** | PostgreSQL 16, Prisma 6, ChromaDB `0.5.20` |
| **Colas & Tiempo Real** | Redis 7, BullMQ 5, Server-Sent Events (SSE) |
| **Automatización & Media** | n8n (WhatsApp Business API + Google Sheets CRM), `unpdf`, `mammoth`, `ffmpeg` |
| **Calidad & CI/CD** | Jest (**129 suites `.spec.ts`**), Supertest, Banco de escenarios generativos, GitHub Actions, Docker multi-stage (Node 22 en prod/CI, Node 20 en dev) |

---

## 🤖 Guía de arranque rápido (Devs y Agentes de IA)

Esta sección está pensada para que **cualquier desarrollador o agente de IA** pueda clonar, configurar, inicializar la base y verificar el proyecto de punta a punta sin fricción.

### 1. Prerrequisitos

- **Docker** y **Docker Compose** (v2+). No necesitás Node.js instalado en el host para levantar el stack completo.
- **Node.js 22+** (opcional en el host, necesario si corrés tests/build fuera de Docker o levantás el frontend local).
- Una **`GOOGLE_API_KEY`** válida de [Google AI Studio](https://aistudio.google.com/apikey).

### 2. Clonar y configurar `.env`

```bash
git clone https://github.com/mauroarmas/TrimIA-Backend.git trimIA
cd trimIA
cp .env.example .env
```

> ⚠️ **ATENCIÓN (Gotcha clave para Docker Compose):**
> `.env.example` trae `localhost` en los hosts pensando en ejecución desde el host. Cuando levantás `nestjs` **dentro de Docker** con `docker compose up`, debés ajustar estas variables en `.env` para que los contenedores resuelvan por la red interna `trimia-net` y coincidan con `docker-compose.yml`:

```env
# 1. API Key obligatoria de Google Gemini
GOOGLE_API_KEY=TU_GOOGLE_API_KEY_REAL

# 2. Password de PostgreSQL (debe ser "trimia" para coincidir con DATABASE_URL en docker-compose.yml)
POSTGRES_USER=trimia
POSTGRES_PASSWORD=trimia
POSTGRES_DB=trimia
DATABASE_URL=postgresql://trimia:trimia@localhost:5433/trimia

# 3. Hosts internos de la red Docker (NO usar localhost si NestJS corre en contenedor)
REDIS_HOST=redis
REDIS_PORT=6379
CHROMA_URL=http://chromadb:8000
N8N_BASE_URL=http://n8n:5678

# 4. Secretos (Joi exige mínimo 32 caracteres en cada uno)
JWT_SECRET=reemplazar-por-secreto-jwt-aleatorio-de-al-menos-32-chars
N8N_WEBHOOK_SECRET=reemplazar-por-secreto-n8n-aleatorio-de-al-menos-32-chars
KNOWLEDGE_ADMIN_SECRET=reemplazar-por-secreto-kb-aleatorio-de-al-menos-32-chars
```

<details>
<summary>⚡ Comando único para dejar el <code>.env</code> listo para Docker (solo reemplazá <code>TU_API_KEY</code>)</summary>

```bash
cp .env.example .env && \
sed -i 's|^GOOGLE_API_KEY=.*|GOOGLE_API_KEY=TU_API_KEY|' .env && \
sed -i 's|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=trimia|' .env && \
sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://trimia:trimia@localhost:5433/trimia|' .env && \
sed -i 's|^REDIS_HOST=.*|REDIS_HOST=redis|' .env && \
sed -i 's|^CHROMA_URL=.*|CHROMA_URL=http://chromadb:8000|' .env && \
sed -i 's|^N8N_BASE_URL=.*|N8N_BASE_URL=http://n8n:5678|' .env
```

</details>

### 3. Levantar servicios, sincronizar esquema y cargar datos de prueba

```bash
# Levanta PostgreSQL (5433), Redis (6379), ChromaDB (8000), n8n (5678) y NestJS API (3000) con hot-reload
docker compose up -d --build

# Sincroniza el esquema en PostgreSQL (este proyecto usa prisma db push, NO prisma migrate)
docker compose exec nestjs npx prisma db push

# Carga sectores, usuarios de prueba y datos iniciales de desarrollo (idempotente)
docker compose exec nestjs npx ts-node prisma/seed.ts
```

> **Alta limpia sin datos de prueba (producción/staging):** en lugar del seed, ejecutá:
> ```bash
> BOOTSTRAP_EMAIL="admin@empresa.com" \
> BOOTSTRAP_NAME="Supervisor Inicial" \
> BOOTSTRAP_PHONE="5491100000000" \
> BOOTSTRAP_PASSWORD="PasswordSegura123!" \
> docker compose exec nestjs npm run bootstrap:supervisor
> ```

### 4. Verificar que todo levantó bien (Smoke Check)

```bash
curl -s http://localhost:3000/health
```

**Servicios y URLs locales:**

| Servicio | URL local | Notas |
|---|---|---|
| **API NestJS (Health)** | `http://localhost:3000/health` | Verifica estado de PostgreSQL, Redis y ChromaDB |
| **Swagger / OpenAPI** | `http://localhost:3000/api` | Documentación interactiva de endpoints |
| **PostgreSQL 16** | `localhost:5433` | Mapeado al `5432` interno para no chocar con Postgres local |
| **Redis 7** | `localhost:6379` | Colas BullMQ y pub/sub SSE |
| **ChromaDB** | `http://localhost:8000` | Almacén vectorial RAG |
| **n8n** | `http://localhost:5678` | Workflows WhatsApp/CRM en `n8n/workflows/` (ver [n8n/README.md](n8n/README.md)) |

### 5. Credenciales creadas por el seed de desarrollo

Todas las cuentas del seed usan la contraseña **`trimia2026`**:

| Email | Nombre | Rol / Perfil | Área(s) |
|---|---|---|---|
| `diego.bazan@credimision.com` | Diego Bazán | `SUPERVISOR` (General) | Todas las áreas (acceso total) |
| `silvia.rios@credimision.com` | Silvia Ríos | `SUPERVISOR` (de área) | Cobranzas |
| `laura.gomez@credimision.com` | Laura Gómez | `EMPLEADO` | Ventas |
| `roberto.sosa@credimision.com` | Roberto Sosa | `EMPLEADO` | Cobranzas |
| `marisa.paz@credimision.com` | Marisa Paz | `EMPLEADO` (`isController`) | Cobranzas (Verificación bancaria) |
| `graciela.medina@credimision.com` | Graciela Medina | `EMPLEADO` | Administración |
| `carlos.ruiz@credimision.com` | Carlos Ruiz | `EMPLEADO` | Logística |
| `ana.torres@credimision.com` | Ana Torres | `EMPLEADO` | Depósito |

### 6. Modo Demo Full-Stack (Backend + Panel + Gateway en `:8080`)

Si clonaste el repositorio hermano `../trimIA-frontend` junto a este directorio y querés levantar el stack completo detrás del gateway local (puerto `8080`, listo para exponer con Tailscale Funnel o correr Cypress E2E):

```bash
bash scripts/demo-local.sh init   # Genera deploy/local/.env a partir de la plantilla
# Completar DEMO_PUBLIC_URL y credenciales de Meta en deploy/local/.env
bash scripts/demo-local.sh up     # Compila frontend, respalda BD, aplica schema y levanta el stack
bash scripts/demo-local.sh status # Estado de contenedores
bash scripts/demo-local.sh logs   # Logs en vivo (nestjs, gateway, n8n)
```

---

## 🧪 Testing y verificación

El repositorio incluye **129 suites de tests unitarios e integración** con Jest, tests del gateway local y un banco de escenarios generativos.

```bash
# Dentro de Docker (sin instalar Node en el host)
docker compose exec nestjs npm test -- --runInBand
docker compose exec nestjs npm run build

# Desde el host (requiere Node 22+ y npm ci)
npm ci
npx prisma generate
npm test -- --runInBand      # Suite Jest completa
npm run build                # Compilación NestJS
npm run test:gateway         # Tests del gateway local (node:test)
npm run lint                 # ESLint
npm run format               # Prettier
```

> El workflow de CI (`.github/workflows/ci.yml`) ejecuta automáticamente `npm ci`, `prisma generate`, `npm run build`, `npm test -- --runInBand`, `npm run test:gateway` y la verificación de las imágenes Docker de producción (`Dockerfile` y `deploy/n8n/Dockerfile`).

---

## 📂 Estructura del repositorio

```text
TrimIA-Backend/
├── src/
│   ├── ai/
│   │   ├── agents/          # 5 agentes especializados + fábrica buildRagAgentGraph + agent-domains.ts
│   │   ├── integrations/    # Puertos y adaptadores externos (CRM Sheets, Stock, Crédito)
│   │   ├── knowledge/       # Ingesta multimodal, búsqueda RAG, higiene y edición asistida
│   │   ├── llm/             # Cliente Gemini (chat, embeddings, vision)
│   │   └── orchestrator/    # Clasificador de intención, ruteo sticky y filtro trivial
│   ├── auth/                # JWT, guardas de rol y revocación de sesiones
│   ├── collections/         # Cuotas, comprobantes Vision, verificación bancaria y recordatorios
│   ├── conversations/       # Hilos, mensajes y eventos de orquestación
│   ├── employees/           # Empleados, sectores y relación N:M de áreas supervisadas
│   ├── escalations/         # Cola HITL por área, takeover/release/reply y enseñanza al RAG
│   ├── financing/           # Flujo venta financiada, seguimiento comercial, opt-out y outbox
│   ├── improvements/        # Cobertura de consultas, revisión documental y mejoras unificadas
│   ├── interviews/          # Entrevistas conversacionales para cerrar brechas del corpus
│   ├── messaging/           # Webhook WhatsApp (n8n), chat web SSE y simulador autenticado
│   ├── queue/               # Colas y processors BullMQ
│   ├── realtime/            # Bus SSE con heartbeat y reanudación por cursor
│   ├── sales/               # Prospectos, stock, dictamen crediticio y cierre comercial
│   ├── supervisor/          # Métricas, auditoría y tablero de gobernanza
│   └── training/            # Píldoras, diagnóstico, pipeline TTS y simulaciones roleplay
├── prisma/                  # schema.prisma, seed.ts y utilidades de mantenimiento
├── n8n/                     # Workflows exportados de WhatsApp/CRM y guía de setup
├── deploy/                  # Gateway local, overrides de demo y empaquetado n8n
├── scripts/                 # Operación de demo, calibración RAG y bootstrap de supervisor
├── specs/                   # Especificaciones funcionales y técnicas (Spec Kit 000–022)
└── docs/                    # Contexto técnico, plan de trabajo y documentación de dominio
```

---

## 🧭 Mapa de contexto para agentes de IA

Si sos un agente de IA trabajando en este repositorio, leé estos archivos antes de modificar código:

1. [`CLAUDE.md`](CLAUDE.md) — Convenciones obligatorias de arquitectura, testing, mocking y flujo de trabajo.
2. [`docs/CONTEXTO_TECNICO.md`](docs/CONTEXTO_TECNICO.md) — Referencia técnica viva de módulos, flujos `020/021/022` y operación.
3. [`src/common/config/config.module.ts`](src/common/config/config.module.ts) — Fuente de verdad de todas las variables de entorno validadas por Joi.
4. [`src/ai/agents/agent-domains.ts`](src/ai/agents/agent-domains.ts) — Fuente única de verdad de dominios y whitelist de agentes por `userType`.
5. [`specs/README.md`](specs/README.md) — Índice de especificaciones implementadas y dependencias entre features.
6. [`n8n/README.md`](n8n/README.md) — Setup manual de Meta/WhatsApp, transcripción de audio y contrato `__AUDIO_NO_TRANSCRIBIBLE__`.
7. [`scripts/README.md`](scripts/README.md) — Inventario de scripts de operación, QA y calibración RAG.

---

<div align="center">

Desarrollado como Proyecto Final de Ingeniería en Sistemas · **TrimIA**

</div>
