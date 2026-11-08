# TrimIA

Plataforma de asistencia con IA para Credimisión S.R.L., desarrollada como proyecto final. Backend NestJS/LangGraph, panel React en el repositorio hermano `trimIA-frontend`.

## Entorno vigente

La demo corre en esta PC con Docker y Tailscale Funnel:

**https://trimia-demo.tail9126e1.ts.net/**

La guía operativa está en [docs/DEMO_LOCAL_WHATSAPP.md](docs/DEMO_LOCAL_WHATSAPP.md). Los datos se conservan en los volúmenes Docker, `storage/` y `n8n/data/`.

```bash
bash scripts/demo-local.sh status
bash scripts/demo-local.sh logs
bash scripts/demo-local.sh backup
```

Para reconstruir y actualizar la demo, con la configuración ya completada:

```bash
bash scripts/demo-local.sh up
```

Ese comando compila el panel, construye las imágenes, respalda la base y comprueba el esquema antes de actualizar los servicios. Revisar cualquier advertencia de Prisma antes de continuar.

## Configuración

| Archivo | Uso |
|---|---|
| `.env` | Configuración privada de API, datos y proveedores |
| `.env.example` | Plantilla de esas variables; sin credenciales reales |
| `deploy/local/.env` | Configuración privada del gateway y URL pública de la demo |
| `deploy/local/.env.example` | Plantilla de demo |

Los archivos privados no se versionan. Las credenciales de Meta configuradas en n8n permanecen en su almacenamiento actual.

## Desarrollo local

Requiere Docker Compose. Para ejecutar herramientas en el host: Node 22 o posterior y `npm ci`.

```bash
cp .env.example .env
# Completar credenciales, modelos y secretos indicados en la plantilla.
docker compose up -d --build
# En una base nueva, preparar el esquema antes de usar la API:
docker compose exec nestjs npx prisma db push
```

El perfil de desarrollo y la demo comparten nombres de servicios y datos: usar el comando correspondiente al entorno elegido.

## Comprobaciones

```bash
npm test -- --runInBand
npm run build
npm run test:gateway
```

API: `http://localhost:3000/health`. Swagger: `http://localhost:3000/api`.

## Documentación y alcance

- [Índice y alcance del MVP](docs/README.md).
- [Contexto técnico vigente](docs/CONTEXTO_TECNICO.md).
- [Contrato del panel](docs/CONTRATO_API_Frontend.md).
- [Especificaciones](specs/README.md).
- [Scripts de mantenimiento y pruebas](scripts/README.md).

El MVP utiliza stock y crédito simulados, con Google Sheets como CRM. GCP queda para la versión final. Paperclip está fuera del alcance acordado.

Los históricos y archivos retirados se guardan, con inventario, en:
`/home/mauro/Cursado-2026/Proyecto-Final/contenido-codigo/limpieza-2026-11-04/`.
