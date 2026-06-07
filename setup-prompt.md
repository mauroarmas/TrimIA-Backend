# Prompts para trabajar el proyecto con Antigravity (Gemini)

Este archivo tiene **tres prompts** listos para copiar y pegar en Antigravity:

1. **Prompt de contexto + skills** — carga el sistema de skills (`skills/`) y el
   contexto del proyecto, para que Antigravity trabaje como un integrante más del
   equipo (pegalo al inicio de cada sesión de trabajo).
2. **Prompt de setup del entorno** — la primera vez, para levantar todo.
3. **Prompt corto del día a día** — para arrancar rápido en sesiones siguientes.

---

## 1. Prompt de contexto (pegar al inicio de una sesión de trabajo)

> Usalo cuando vas a **implementar / modificar código**, no solo levantar el entorno.

```
Vas a trabajar en TrimIA, el backend NestJS de una plataforma de agentes de IA para
la empresa Credimisión S.R.L. (tesis de grado). Antes de proponer o escribir cualquier
código, cargá DOS cosas en este orden: (A) el sistema de skills y (B) el contexto del
proyecto.

## A) Sistema de skills (superpowers)

Este repo incluye una carpeta `skills/` (de https://github.com/obra/superpowers) que
define CÓMO debés trabajar. Cargala primero:

1. Leé `skills/using-superpowers/SKILL.md` — es el bootstrap: explica cómo encontrar y
   usar las demás skills.
2. Leé `skills/using-superpowers/references/gemini-tools.md` — mapea los nombres de
   herramientas de Claude Code que usan las skills a tus herramientas de Gemini
   (`Read`→`view_file`, `Write`→`write_to_file`, `Bash`→`run_command`, etc.).
3. Registrá las skills disponibles (cada subcarpeta de `skills/` tiene su `SKILL.md`):
   brainstorming, writing-plans, executing-plans, test-driven-development,
   systematic-debugging, verification-before-completion, requesting-code-review,
   receiving-code-review, subagent-driven-development, dispatching-parallel-agents,
   using-git-worktrees, finishing-a-development-branch, writing-skills.

Regla de skills: ANTES de cualquier acción no trivial, fijate si aplica una skill y, si
hay aunque sea un 1% de chance de que aplique, leé su `SKILL.md` y seguila. Ejemplos:
feature nueva → `brainstorming` antes de codear; bug → `systematic-debugging` antes de
proponer fix; código nuevo → `test-driven-development`; antes de decir "listo" →
`verification-before-completion`.

## B) Contexto del proyecto

1. Leé COMPLETO `docs/CONTEXTO_TECNICO.md`. Es el documento maestro: stack, estructura
   real del código, flujo de un mensaje, los 5 agentes, el RAG, el modelo de datos, el
   estado por fases, el mapeo de requisitos a entregables, las tareas pendientes y las
   reglas que NO se deben romper.
2. Leé también, según lo que vayas a tocar: `README.md` (entorno),
   `docs/ArquitecturaFLujoTrabajo.md` (arquitectura ampliada), y el código del módulo
   en `src/`.

## Reglas de trabajo conmigo

- **Citá la fuente:** para cada afirmación sobre el código o el proyecto, indicá el
  archivo/sección de donde la sacaste. No completes con suposiciones; si no está en el
  doc o el código, decí "no lo sé" en vez de inventar.
- **Usá la skill que corresponda** antes de actuar (ver regla de skills arriba).
- **Convenciones del proyecto:** patrón de agente = `<agente>.graph.ts` +
  `<agente>.prompt.ts` con la fábrica `buildRagAgentGraph`; inyección de dependencias;
  env vars validadas en `config.module.ts`.
- **Confidencialidad (regla de oro):** un CLIENTE jamás debe acceder a conocimiento
  INTERNO ni a agentes no permitidos (ver `allowedAgentsFor`).
- **RAG estricto:** los agentes responden SOLO con el contexto recuperado; si no
  alcanza, escalan a humano.
- **Antes de dar algo por terminado:** corré los tests (`docker compose exec nestjs npx
  jest --no-coverage`) y verificá que compila/arranca (skill `verification-before-completion`).
- Cambios incrementales y explicados. Si algo es ambiguo, preguntame antes de asumir.

Cuando termines de cargar A y B, resumime en 5-6 líneas: qué es el proyecto, en qué
fase está, las 3 reglas más importantes, y CON QUÉ SKILLS vas a trabajar. Citá las
secciones/archivos. Recién después arrancamos la tarea.
```

---

## 2. Prompt de setup del entorno (primera vez)

> Para dejar el proyecto corriendo en una máquina nueva.

```
Necesito configurar este proyecto en mi máquina local para arrancar a desarrollar. No
tengo mucha experiencia con Docker ni backend, así que guiame paso a paso, verificando
cada paso antes de pasar al siguiente.

## Sobre el proyecto
Es TrimIA, un backend NestJS para una plataforma de agentes IA (ventas, administración/
crédito, cobranzas, logística y depósito) que atiende por WhatsApp y capacita empleados,
con arquitectura RAG. El contexto técnico completo está en `docs/CONTEXTO_TECNICO.md` y
el setup en `README.md`.

## Lo que tengo instalado
- Docker Desktop (instalado y corriendo — si no, avisame cómo verificarlo)
- Git
- Estoy en Windows, usando Antigravity con vos

## Pasos

### Paso 1 — Contexto
Leé el `README.md` y `docs/CONTEXTO_TECNICO.md`. Confirmame en una frase qué entendiste.

### Paso 2 — Verificar Docker
Ejecutá `docker --version` y `docker compose version`. Si fallan, ayudame a diagnosticar.

### Paso 3 — Variables de entorno
1. Copiá `.env.example` a `.env` (en Windows: `copy .env.example .env`).
2. Mostrame qué variables quedaron listas y cuál falta completar.
3. La única que requiere mi intervención es `GOOGLE_API_KEY` — guiame para obtenerla en
   https://aistudio.google.com/apikey. El resto de los valores funcionan tal cual para
   desarrollo local (modelo Gemini, embeddings y umbral ya vienen con default).
4. Confirmá que `.env` está en `.gitignore` (NUNCA debe subirse al repo).

### Paso 4 — Levantar los servicios
Ejecutá `docker compose up -d --build` y explicame qué hace mientras corre (~2-3 min la
primera vez). Después corré `docker compose ps` y verificá que los 5 servicios (postgres,
redis, chromadb, n8n, nestjs) están "Up"; postgres/redis/chromadb deben decir "healthy".

### Paso 5 — Esperar que NestJS arranque
Mostrame `docker compose logs nestjs -f` hasta que aparezca "Nest application
successfully started". Si hay errores antes, ayudame a resolverlos. Cortá con Ctrl+C.

### Paso 6 — Crear las tablas de la base de datos
Ejecutá: `docker compose exec nestjs npx prisma db push`
Debe decir "Your database is now in sync with your Prisma schema". Si dice "drift
detected" o pide reset, NO uses `migrate reset` directamente — avisame primero.

### Paso 7 — Verificar que todo funciona
1. `curl http://localhost:3000/health` → 200 con postgres, redis y memory_heap en "up".
2. Abrí http://localhost:3000/api → debe verse el Swagger.
3. Abrí http://localhost:5678 → interfaz de n8n (la primera vez pide crear admin; eso lo hago yo).

## Si algo falla (en orden de probabilidad)
1. Docker Desktop no está corriendo → abrilo y esperá "Engine running".
2. Puerto ocupado → el proyecto usa 3000, 5433, 6379, 5678, 8000. Decime cómo identificar
   qué proceso lo tiene.
3. `GOOGLE_API_KEY` vacía o inválida → NestJS no arranca si la validación de env vars falla.
4. NestJS en "Restarting" → mostrame los logs para diagnosticar.

## No hagas esto sin avisarme primero
- `docker compose down -v` (borra todos los datos de la DB).
- `prisma migrate reset` (puede borrar datos).
- Cambiar versiones de paquetes en `package.json` sin necesidad.

Empezá por el Paso 1. No saltes pasos. Esperá mi confirmación después de cada uno.
```

---

## 3. Prompt corto (día a día)

```
Levantá el proyecto: `docker compose up -d`, esperá que todos los servicios estén Up,
mostrame `docker compose ps`, y dejame los logs de NestJS abiertos con
`docker compose logs nestjs -f`.
```
