# Quickstart: 015 — Diagnóstico Inicial y Progresión por Puesto

**Feature**: `015-diagnostico-inicial-y-progresion`  
**Fecha**: 2026-10-04  

Este documento describe 3 escenarios de prueba end-to-end ejecutables contra el backend de TrimIA para validar la generación del diagnóstico, la exención temática automática y la visualización/reinicio por parte del supervisor.

---

## Prerrequisitos

1. Servicios Docker arriba: `docker compose ps` (PostgreSQL, Redis, ChromaDB, NestJS).
2. Token JWT de empleado de Cobranzas (`EMPLOYEE_TOKEN`) y supervisor de Cobranzas (`SUPERVISOR_TOKEN`, ej. Silvia Ríos).
3. Al menos 2 módulos formativos publicados en Cobranzas con píldoras y cuestionarios válidos (creados en Spec 014).

---

## Escenario 1: Generación y Rendición Exitosa con Exención Parcial

### 1.1 Obtener Cuestionario Diagnóstico
```bash
curl -X GET http://localhost:3000/training/diagnostic \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN"
```
**Respuesta esperada (200 OK)**:
- JSON con `totalQuestions` entre 5 y 8.
- Cada pregunta contiene `moduleId`, `pillId`, `questionId`, `question`, `options`.
- **Ninguna pregunta** incluye `correctOptionIndex` ni `explanation`.

### 1.2 Enviar Respuestas (100% aciertos en Módulo 1, errores en Módulo 2)
```bash
curl -X POST http://localhost:3000/training/diagnostic/submit \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "answers": [
      { "pillId": "pill-mod1-1", "questionId": 1, "selectedOptionIndex": 0 },
      { "pillId": "pill-mod1-2", "questionId": 1, "selectedOptionIndex": 1 },
      { "pillId": "pill-mod2-1", "questionId": 1, "selectedOptionIndex": 2 }
    ]
  }'
```
**Respuesta esperada (200 OK)**:
- `exemptedModules` incluye el `id` y `title` del Módulo 1.
- `pendingModules` incluye el Módulo 2.
- `score` calculado acorde al total de aciertos.

---

## Escenario 2: Verificación de Desbloqueo Dinámico y Acceso a Lecciones

### 2.1 Consultar Módulos del Empleado
```bash
curl -X GET http://localhost:3000/training/modules \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN"
```
**Respuesta esperada (200 OK)**:
- Las píldoras del Módulo 1 exhiben `status: "EXEMPTED_BY_DIAGNOSTIC"` y `isLocked: false`.
- La primera píldora del Módulo 2 (inmediatamente posterior al eximido) exhibe `status: "NOT_STARTED"` y `isLocked: false` (desbloqueada por el efecto de exención).

### 2.2 Lectura Voluntaria de Píldora Eximida
```bash
curl -X GET http://localhost:3000/training/pills/pill-mod1-1 \
  -H "Authorization: Bearer $EMPLOYEE_TOKEN"
```
**Respuesta esperada (200 OK)**:
- Acceso permitido con código 200 y contenido completo del procedimiento teórico para consulta de repaso.

---

## Escenario 3: Auditoría y Reinicio por Supervisor

### 3.1 Consulta de Diagnóstico por Supervisor de Cobranzas
```bash
curl -X GET http://localhost:3000/training/supervisor/diagnostic/$EMPLOYEE_ID \
  -H "Authorization: Bearer $SUPERVISOR_TOKEN"
```
**Respuesta esperada (200 OK)**:
- Detalle con `score`, `totalQuestions`, `correctAnswers` y lista de `exemptedModuleIds`.

### 3.2 Intento de Consulta por Supervisor Ajeno (Ventas intentando ver Cobranzas)
```bash
curl -X GET http://localhost:3000/training/supervisor/diagnostic/$EMPLOYEE_ID \
  -H "Authorization: Bearer $VENTAS_SUPERVISOR_TOKEN"
```
**Respuesta esperada (403 Forbidden)**:
- Acceso denegado respetando `assertPuedeEscribir` (Principio I).

### 3.3 Reinicio de Diagnóstico por Supervisor Autorizado
```bash
curl -X POST http://localhost:3000/training/supervisor/diagnostic/$EMPLOYEE_ID/reset \
  -H "Authorization: Bearer $SUPERVISOR_TOKEN"
```
**Respuesta esperada (200 OK)**:
- `{ "success": true, "message": "Diagnóstico reiniciado exitosamente" }`.
- El empleado vuelve a quedar habilitado para rendir `GET /training/diagnostic`.
