# TrimIA — Backend

Backend del sistema de agentes IA para empresas comerciales. Construido con NestJS + LangGraph + Gemini. Desarrollado como tesis de grado.

## Stack

| Servicio   | Descripción                              | Puerto (host) |
|-----------|------------------------------------------|---------------|
| NestJS    | API principal (hot reload en dev)        | 3000          |
| PostgreSQL | Base de datos relacional (Prisma + LangGraph checkpointer) | 5433 |
| Redis     | Cola de mensajes (BullMQ)               | 6379          |
| ChromaDB  | Vector store para RAG                    | 8000          |
| n8n       | Orquestador de workflows (WhatsApp)      | 5678          |

## Requisitos previos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y corriendo
- Git

No se necesita Node.js ni npm instalados localmente — todo corre dentro de Docker.

## Instalación (primera vez)

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd trim-ia-backend
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` y completar los valores necesarios. El único que **no tiene default** es:

```
GOOGLE_API_KEY=your_google_api_key_here   # Obtener en https://aistudio.google.com/apikey
```

El resto de los valores del `.env.example` funcionan tal cual para desarrollo local.

### 3. Levantar los servicios

```bash
docker compose up -d --build
```

La primera vez descarga las imágenes y construye el contenedor de NestJS (~2-3 min). Las siguientes veces es mucho más rápido gracias al caché de npm.

### 4. Crear las tablas de la base de datos

Solo se hace **una vez** (o cuando se resetea la DB):

```bash
docker compose exec nestjs npx prisma migrate reset --force
```

Esto crea todas las tablas de negocio (Prisma) y las tablas del checkpointer de LangGraph.

### 5. Verificar que todo funciona

```bash
curl http://localhost:3000/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "info": {
    "postgres": { "status": "up" },
    "redis": { "status": "up" },
    "memory_heap": { "status": "up" }
  }
}
```

También se puede acceder al Swagger en [http://localhost:3000/api](http://localhost:3000/api).

## Uso diario

### Levantar todo

```bash
docker compose up -d
```

### Ver logs de NestJS en tiempo real

```bash
docker compose logs nestjs -f
```

### Detener todo

```bash
docker compose down
```

### Detener y borrar volúmenes (reset completo de DB)

```bash
docker compose down -v
```

## Comandos útiles

### Prisma

```bash
# Crear una nueva migración después de modificar schema.prisma
docker compose exec nestjs npx prisma migrate dev --name nombre_de_la_migracion

# Abrir Prisma Studio (explorador visual de la DB)
docker compose exec nestjs npx prisma studio

# Resetear la DB (borra todos los datos y vuelve a migrar)
docker compose exec nestjs npx prisma migrate reset --force
```

### Docker

```bash
# Ver el estado de todos los contenedores
docker compose ps

# Reconstruir solo el contenedor de NestJS (tras cambios en Dockerfile o package.json)
docker compose up -d --build nestjs

# Entrar al contenedor de NestJS
docker compose exec nestjs sh
```

## Estructura del proyecto

```
src/
├── config/          # Variables de entorno con validación Joi
├── database/        # PrismaModule (singleton global)
├── redis/           # RedisModule (ioredis)
├── ai/
│   └── checkpointer/  # PostgresSaver de LangGraph (crea sus propias tablas)
└── health/          # GET /health — estado de postgres, redis y memoria
```

## Notas importantes

- **`DATABASE_URL` en Docker**: el `docker-compose.yml` inyecta `postgres:5432` automáticamente para que NestJS se conecte por la red interna. El valor en `.env` (`localhost:5433`) es para conectarse desde herramientas externas como pgAdmin.
- **Tablas de LangGraph**: las tablas `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` y `checkpoint_migrations` son creadas y gestionadas por LangGraph, no por Prisma. No modificarlas manualmente.
- **Hot reload**: NestJS corre en modo `--watch`. Cualquier cambio en `src/` se compila y recarga automáticamente sin reiniciar el contenedor.