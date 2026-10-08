# Quickstart & Integration Scenarios: 016 — Pipeline de Audio: Guion a 2 Voces y Síntesis TTS

**Feature**: [spec.md](./spec.md)  
**Status**: Completed  
**Date**: 2026-10-06  

---

## Prerrequisitos

1. Contenedores de desarrollo activos (`docker compose ps`):
   - PostgreSQL (`5433:5432`)
   - Redis (`6379:6379`)
   - NestJS (`3000:3000`)
2. Usuarios de prueba sembrados (`prisma/seed.ts`):
   - **Supervisora Cobranzas**: `silvia.rios@credimision.com` / `trimia2026`
   - **Empleado Cobranzas**: `roberto.sosa@credimision.com` / `trimia2026`
   - **Supervisor Ventas**: `diego.bazan@credimision.com` / `trimia2026`
3. Al menos una píldora publicada en el sector Cobranzas.

---

## Escenario 1: Generación y Edición del Guion a Dos Voces (US1)

### 1.1 Iniciar sesión como Supervisora de Cobranzas
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"silvia.rios@credimision.com","password":"trimia2026"}'
```
*Respuesta esperada*: `200 OK` con `{ "accessToken": "..." }`.

### 1.2 Generar guion conversacional con IA
```bash
curl -X POST http://localhost:3000/training/pills/{PILL_ID}/script \
  -H "Authorization: Bearer $SUPERVISOR_TOKEN"
```
*Resultado esperado*: `201 Created`
- Retorna `estimatedDurationSeconds` y un array de `dialogue` alternando entre `SPEAKER_1` y `SPEAKER_2`.
- El texto refleja el contenido teórico con modismos y explicaciones dialógicas.

### 1.3 Editar parlamento del guion
```bash
curl -X PUT http://localhost:3000/training/pills/{PILL_ID}/script \
  -H "Authorization: Bearer $SUPERVISOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "estimatedDurationSeconds": 180,
    "dialogue": [
      { "speaker": "SPEAKER_1", "text": "Hola Roberto, hoy vamos a revisar las pautas de cobranzas en Credimisión." },
      { "speaker": "SPEAKER_2", "text": "¿Y qué hacemos si el titular no nos atiende el teléfono?" }
    ]
  }'
```
*Resultado esperado*: `200 OK` con el guion persistido.

---

## Escenario 2: Procesamiento Asíncrono en BullMQ y Streaming HTTP (US2)

### 2.1 Encolar la síntesis de audio
```bash
curl -X POST http://localhost:3000/training/pills/{PILL_ID}/audio/generate \
  -H "Authorization: Bearer $SUPERVISOR_TOKEN"
```
*Resultado esperado*: `202 Accepted`
- Retorna de inmediato: `{ "pillId": "...", "status": "AUDIO_PENDING" }` sin bloquear la conexión HTTP.

### 2.2 Consultar estado de procesamiento
```bash
curl -X GET http://localhost:3000/training/pills/{PILL_ID}/audio/status \
  -H "Authorization: Bearer $SUPERVISOR_TOKEN"
```
*Resultado esperado*: Tras procesar el worker BullMQ, el estado transiciona a:
```json
{
  "pillId": "...",
  "status": "AUDIO_READY",
  "durationSeconds": 180,
  "streamUrl": "/training/pills/{PILL_ID}/audio"
}
```

### 2.3 Streaming parcial con cabecera Range
```bash
curl -i -X GET http://localhost:3000/training/pills/{PILL_ID}/audio \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Range: bytes=0-1024"
```
*Resultado esperado*:
- Código de estado: `206 Partial Content`
- Cabeceras: `Content-Range: bytes 0-1024/...`, `Accept-Ranges: bytes`, `Content-Type: audio/mpeg`.

---

## Escenario 3: Progreso de Reproducción y Desbloqueo al 80% (US3)

### 3.1 Reportar avance normal de escucha
```bash
# Reporte a los 30 segundos
curl -X POST http://localhost:3000/training/pills/{PILL_ID}/playback-progress \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentSeconds": 30}'

# Reporte al superar el 80% (ej. 150s de 180s = 83.3%)
curl -X POST http://localhost:3000/training/pills/{PILL_ID}/playback-progress \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentSeconds": 150}'
```
*Resultado esperado*:
```json
{
  "playbackProgressSeconds": 150,
  "totalDurationSeconds": 180,
  "percentage": 83.3,
  "isAudioCompleted": true,
  "message": "Requisito de audio completado satisfactoriamente"
}
```

### 3.2 Detección de salto temporal fraudulento
```bash
# Intento de saltar de 0s a 170s en 1 segundo
curl -X POST http://localhost:3000/training/pills/{PILL_ID}/playback-progress \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentSeconds": 170}'
```
*Resultado esperado*: `400 Bad Request` o avance acotado al tiempo real transcurrido sin otorgar `isAudioCompleted: true`.

---

## Escenario 4: Gobernanza y Control de Sector (US4 y Principio I)

### 4.1 Intento de generación por supervisor de sector no autorizado
Con token de supervisor que no posee permisos sobre Cobranzas (ej. supervisor de Ventas):
```bash
curl -X POST http://localhost:3000/training/pills/{COBRANZAS_PILL_ID}/audio/generate \
  -H "Authorization: Bearer $VENTAS_SUPERVISOR_TOKEN"
```
*Resultado esperado*: `403 Forbidden` (`Área ajena: no tiene permisos para generar audio en este sector`).
