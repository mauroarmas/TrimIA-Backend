# Quickstart Validation Guide: Práctica Guiada y Simulación Libre

**Feature**: `017-practica-guiada-simulacion`  
**Date**: 2026-10-13  
**Status**: Ready

Este documento detalla los pasos y comandos para validar de extremo a extremo las capacidades de práctica guiada con checklist en vivo y simulación libre con devolución en 3 tarjetas.

---

## 1. Prerrequisitos

1. Backend de TrimIA en ejecución (`docker-compose up` o `npm run start:dev` en puerto 3000).
2. Base de datos con migraciones de simulación aplicadas (`npx prisma migrate dev`).
3. Token de autenticación de un empleado (ej. `roberto.sosa@credimision.com`) y de un supervisor (`diego.bazan@credimision.com`).
4. Al menos una píldora publicada en el sistema.

---

## 2. Escenario 1: Práctica Guiada con Checklist en Vivo (P1)

### Paso 1: Iniciar sesión guiada
```bash
POST /training/pills/{pillId}/simulations
Authorization: Bearer <TOKEN_EMPLEADO>
Content-Type: application/json

{
  "mode": "GUIDED"
}
```
**Resultado esperado (HTTP 201)**:
- Se genera `sessionId`.
- Se crea el perfil del cliente simulado (`customerName`, `customerProfile`).
- Se devuelven entre 3 y 5 `goals` pedagógicos en estado `isCompleted: false`.

### Paso 2: Enviar saludo inicial y solicitud de DNI
```bash
POST /training/simulations/{sessionId}/messages
Authorization: Bearer <TOKEN_EMPLEADO>
Content-Type: application/json

{
  "content": "¡Hola! Buenos días, bienvenido a Credimisión. ¿Podrías indicarme tu número de DNI para revisar tu consulta?"
}
```
**Resultado esperado (HTTP 200)**:
- `clientMessage`: Contesta en personaje como el cliente simulado facilitando su documento y planteando su problema.
- `updatedGoals`: El objetivo de "Saludo inicial y solicitud de documento" pasa a `isCompleted: true` con su evidencia textual.
- Latencia menor a 2.5 segundos.

---

## 3. Escenario 2: Simulación Libre y Devolución Cualitativa (P2 y P3)

### Paso 1: Iniciar sesión libre
```bash
POST /training/pills/{pillId}/simulations
Authorization: Bearer <TOKEN_EMPLEADO>
Content-Type: application/json

{
  "mode": "FREE"
}
```
**Resultado esperado (HTTP 201)**:
- `mode: "FREE"`.
- `goals`: Array vacío (no hay checklist en vivo visible).

### Paso 2: Intercambiar mensajes libres
```bash
POST /training/simulations/{sessionId}/messages
Authorization: Bearer <TOKEN_EMPLEADO>
Content-Type: application/json

{
  "content": "Hola, ¿en qué podemos ayudarte hoy?"
}
```

### Paso 3: Concluir simulación y recibir las 3 tarjetas cualitativas
```bash
POST /training/simulations/{sessionId}/conclude
Authorization: Bearer <TOKEN_EMPLEADO>
```
**Resultado esperado (HTTP 200)**:
- Objeto `SimulationFeedback` generado con:
  - `band`: `ACHIEVED`, `NEEDS_IMPROVEMENT` o `NOT_ACHIEVED`.
  - `whatWentWell`: Fortalezas pedagógicas con citas.
  - `toImprove`: Consejos de mejora específicos.
  - `businessRules`: Adherencia a políticas de Credimisión.
  - Cero números o notas de 0 a 100.

---

## 4. Escenario 3: Auditoría por el Supervisor (P3)

```bash
GET /training/supervisor/employees/{employeeId}/simulations
Authorization: Bearer <TOKEN_SUPERVISOR>
```
**Resultado esperado (HTTP 200)**:
- Retorna el historial de sesiones de práctica del empleado con sus bandas y acceso a las transcripciones y tarjetas de feedback.

