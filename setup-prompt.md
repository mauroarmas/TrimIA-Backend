# Prompt para configurar el proyecto con Antigravity/Gemini

Copiá y pegá el bloque de abajo en Antigravity una vez que clonaste el repo y abriste la carpeta como workspace. Gemini te va a guiar paso a paso.

---

```
Necesito configurar este proyecto en mi máquina local para arrancar a desarrollar. No tengo mucha experiencia con Docker ni con backend, así que necesito que me guíes paso a paso, verificando cada paso antes de pasar al siguiente.

## Sobre el proyecto

Es TrimIA, un backend NestJS para una plataforma de agentes IA (ventas, administración/crédito, cobranzas, logística y depósito) que atiende por WhatsApp y capacita empleados, con arquitectura RAG. La documentación detallada está en el README.md y en docs/ArquitecturaFLujoTrabajo.md.

## Lo que tengo instalado

- Docker Desktop (instalado y corriendo — si no, avisame cómo verificarlo)
- Git
- Estoy en Windows, usando Antigravity con vos

## Lo que necesito que hagas

### Paso 1 — Contexto
Leé el README.md de este repositorio para conocer el proyecto. Después confirmame en una frase qué entendiste antes de seguir.

### Paso 2 — Verificar Docker
Ejecutá `docker --version` y `docker compose version` para confirmar que están disponibles. Si no funcionan, ayudame a diagnosticar.

### Paso 3 — Configurar variables de entorno
1. Copiar `.env.example` a `.env` (en Windows: `copy .env.example .env`)
2. Abrir el `.env` y mostrarme qué variables están listas y cuál falta completar
3. La única que requiere intervención mía es `GOOGLE_API_KEY` — guiame para obtenerla en https://aistudio.google.com/apikey. (El modelo de Gemini ya viene con un default en `GEMINI_MODEL`, no hace falta tocarlo.)
4. Confirmá que `.env` está en `.gitignore` antes de seguir (NUNCA debe subirse al repo)

### Paso 4 — Levantar los servicios
Ejecutá `docker compose up -d --build` y explicame qué está haciendo mientras corre. Puede tardar 2-3 minutos la primera vez.

Cuando termine, corré `docker compose ps` y verificá que los 5 servicios (postgres, redis, chromadb, n8n, nestjs) están "Up". Para postgres, redis y chromadb debe decir "healthy".

### Paso 5 — Esperar que NestJS arranque
Mostrame los logs con `docker compose logs nestjs -f` y esperá hasta que aparezca el mensaje "Nest application successfully started". Si aparecen errores antes, ayudame a resolverlos.

Cortá los logs con Ctrl+C cuando confirmes que arrancó bien.

### Paso 6 — Crear las tablas de la base de datos
Ejecutá:
docker compose exec nestjs npx prisma db push

Debe decir "Your database is now in sync with your Prisma schema". Si dice "drift detected" o pide reset, NO uses migrate reset directamente — avisame primero.

### Paso 7 — Verificar que todo funciona
1. `curl http://localhost:3000/health` debe devolver 200 con postgres, redis y memory_heap en "up"
2. Abrí http://localhost:3000/api en el navegador y confirmá que se ve el Swagger con los endpoints
3. Abrí http://localhost:5678 y confirmá que aparece la interfaz de n8n (la primera vez te va a pedir crear un usuario admin, esa parte la hago yo)

## Si algo falla

**Problemas comunes (en orden de probabilidad):**

1. **Docker Desktop no está corriendo** — abrir Docker Desktop y esperar que el ícono diga "Engine running"
2. **Puerto ocupado** — los puertos que usa el proyecto son 3000, 5433 (postgres), 6379 (redis), 5678 (n8n), 8000 (chromadb). Si alguno está en uso, decime cómo identificar qué proceso lo tiene
3. **`GOOGLE_API_KEY` vacía o inválida** — NestJS no arranca si la validación de env vars falla
4. **Error de `prisma db push`** — puede pasar si las tablas del checkpointer de LangGraph ya existen. NO ejecutes `migrate reset` sin consultarme
5. **NestJS no responde en localhost:3000** — verificá que el contenedor esté Up con `docker compose ps`, no Restarting

## No hagas estas cosas sin avisarme primero

- `docker compose down -v` (borra todos los datos de la DB)
- `prisma migrate reset` (puede borrar datos en desarrollo compartido)
- Modificar archivos en `prisma/migrations/` si existen
- Cambiar versiones de paquetes en `package.json` sin necesidad

## Stack para que tengas contexto

- NestJS + TypeScript en `src/`
- Prisma como ORM (schema en `prisma/schema.prisma`)
- PostgreSQL para datos de negocio + checkpointer de LangGraph
- Redis para colas de mensajes (BullMQ)
- LangGraph + Gemini para el orquestador y los 5 agentes especializados
- ChromaDB para vector store (RAG, se usa desde Fase 4)
- n8n para webhooks de WhatsApp

Empezá por el Paso 1. No saltes pasos. Después de cada uno, esperá mi confirmación antes de seguir.
```

---

## Prompt corto para el día a día

Una vez que corriste el flujo de arriba al menos una vez, en sesiones siguientes alcanza con:

```
Levantá el proyecto: `docker compose up -d`, esperá que todos los servicios estén Up, mostrame `docker compose ps`, y dejame los logs de NestJS abiertos con `docker compose logs nestjs -f`.
```