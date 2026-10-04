# Quickstart: Validación de Estructura de Capacitación y Generación de Píldoras

**Feature**: `014-estructura-y-generacion-de-pildoras`
**Fecha**: 2026-10-04

Guía de verificación rápida de los flujos de la especificación para comprobar el funcionamiento end-to-end.

---

## 1. Prerrequisitos

1. Base de datos PostgreSQL y Redis levantados (`docker compose up -d postgres redis`).
2. Esquema sincronizado con `npx prisma db push`.
3. Corpus base cargado (o seed de pruebas ejecutado: `npm run seed`).
4. Tokens JWT válidos para dos usuarios de prueba:
   - **Silvia** (Supervisor de Cobranzas).
   - **Diego** (Supervisor de todas las áreas).
   - **Empleado Ventas** / **Empleado Cobranzas** (rol `EMPLEADO`).

---

## 2. Escenario 1: Generación y Publicación por Supervisor (US1 & US2)

### Paso A: Generar píldora con IA sobre tema de Cobranzas
```bash
curl -X POST http://localhost:3000/training/pills/generate \
  -H "Authorization: Bearer $SILVIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleId": "$MODULO_COBRANZAS_ID",
    "topic": "Recepción y validación de comprobantes de pago",
    "additionalNotes": "Enfocarse en revisar el código de operación y fecha"
  }'
```
**Resultado esperado:**
- Código HTTP `201 Created`.
- Retorna JSON con `status: "DRAFT"`, título, objetivo pedagógico, pasos numerados y 2 preguntas en `quiz`.

### Paso B: Verificar que un empleado NO ve el borrador
```bash
curl -X GET http://localhost:3000/training/pills/$PILL_ID \
  -H "Authorization: Bearer $EMPLEADO_TOKEN"
```
**Resultado esperado:**
- Código HTTP `403 Forbidden` o `404 Not Found`.

### Paso C: Supervisor aprueba y publica
```bash
curl -X POST http://localhost:3000/training/pills/$PILL_ID/publish \
  -H "Authorization: Bearer $SILVIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "indexInKnowledge": false }'
```
**Resultado esperado:**
- Código HTTP `200 OK`.
- Píldora pasa a `status: "PUBLISHED"`, con `publishedById` y `publishedAt` asignados.

---

## 3. Escenario 2: Aprendizaje y Evaluación del Empleado (US3 & US4)

### Paso A: El empleado consulta la píldora publicada
```bash
curl -X GET http://localhost:3000/training/pills/$PILL_ID \
  -H "Authorization: Bearer $EMPLEADO_COBRANZAS_TOKEN"
```
**Resultado esperado:**
- Código HTTP `200 OK`.
- Devuelve pasos teóricos y el `quiz` con las 2 preguntas (sin exponer los índices correctos).

### Paso B: El empleado responde incorrectamente (falla intencional)
```bash
curl -X POST http://localhost:3000/training/pills/$PILL_ID/verify \
  -H "Authorization: Bearer $EMPLEADO_COBRANZAS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "answers": [99, 99] }'
```
**Resultado esperado:**
- Código HTTP `200 OK` con `{ "passed": false, "failedIndices": [0, 1], "explanations": [...] }`.
- La píldora se mantiene en `IN_PROGRESS` en `EmployeeProgress`.

### Paso C: El empleado responde correctamente
```bash
curl -X POST http://localhost:3000/training/pills/$PILL_ID/verify \
  -H "Authorization: Bearer $EMPLEADO_COBRANZAS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "answers": [$RESPUESTA_1_CORRECTA, $RESPUESTA_2_CORRECTA] }'
```
**Resultado esperado:**
- Código HTTP `200 OK` con `{ "passed": true, "explanations": [...], "nextPillId": ... }`.
- El progreso cambia a `COMPLETED`. La siguiente píldora secuencial se desbloquea.

---

## 4. Escenario 3: Control de Permisos por Sector (Principio I)

### Intento de Silvia (Cobranzas) de publicar en un módulo de Ventas
```bash
curl -X POST http://localhost:3000/training/pills/$PILL_VENTAS_ID/publish \
  -H "Authorization: Bearer $SILVIA_TOKEN"
```
**Resultado esperado:**
- Código HTTP `403 Forbidden` (`No autorizado para modificar contenidos de un sector ajeno`).

---

## 5. Ejecución de Tests Automatizados

```bash
# Correr suite de tests del módulo de capacitación
npm test -- src/training/
```
**Resultado esperado:**
- Todos los tests de controlador, servicio, generador y validaciones pasan en verde.
