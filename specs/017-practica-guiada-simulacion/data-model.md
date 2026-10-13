# Data Model: Práctica Guiada, Simulación Libre y Devolución Cualitativa

**Feature**: `017-practica-guiada-simulacion`  
**Date**: 2026-10-13  
**Status**: Ready

Este documento especifica los modelos de datos que se agregarán a `prisma/schema.prisma` para soportar las sesiones de simulación interactiva, mensajes de práctica, objetivos de checklist y evaluaciones cualitativas.

---

## 1. Entidades y Esquema Prisma

```prisma
// Modalidad de la sesión de simulación
enum SimulationMode {
  GUIDED   // Práctica guiada con panel de objetivos turno a turno
  FREE     // Simulación libre sin ayudas en vivo
}

// Estado del ciclo de vida de la sesión
enum SimulationStatus {
  IN_PROGRESS
  COMPLETED
  ABANDONED
}

// Bandas cualitativas de evaluación formativa
enum PerformanceBand {
  ACHIEVED          // Logrado: cumple los criterios y reglas del negocio
  NEEDS_IMPROVEMENT // A mejorar: cumple parcialmente o requiere pulir técnica
  NOT_ACHIEVED      // No logrado: incumple reglas críticas o no resuelve
}

// Remitente de cada mensaje en el simulador
enum SimulationSender {
  EMPLOYEE
  SIMULATED_CLIENT
}

// Sesión de práctica de simulación
model SimulationSession {
  id              String            @id @default(uuid())
  employeeId      String
  pillId          String
  mode            SimulationMode
  status          SimulationStatus  @default(IN_PROGRESS)
  
  // Contexto del caso simulado
  scenarioTitle   String            // Título breve del escenario (ej. "Consulta por crédito moroso")
  customerName    String            // Nombre del cliente ficticio (ej. "Mariana Gómez")
  customerProfile String            @db.Text // Datos de fondo, deuda, producto, tono emocional
  
  createdAt       DateTime          @default(now())
  completedAt     DateTime?
  
  // Relaciones
  employee        Employee          @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  pill            TrainingPill      @relation(fields: [pillId], references: [id], onDelete: Cascade)
  messages        SimulationMessage[]
  goals           SimulationGoal[]
  feedback        SimulationFeedback?

  @@index([employeeId, pillId])
  @@index([status])
}

// Mensaje individual dentro de la sesión de simulación
model SimulationMessage {
  id              String            @id @default(uuid())
  sessionId       String
  sender          SimulationSender
  content         String            @db.Text
  turnIndex       Int               // Orden cronológico del turno (0, 1, 2...)
  
  // Metadatos de evaluación en vivo (solo en modo GUIDED)
  completedGoalIds Json?            // Array de strings con IDs de objetivos cumplidos en este turno
  emotion         String?           // Emoción o tono percibido ("neutral", "frustrado", "satisfecho")
  createdAt       DateTime          @default(now())

  session         SimulationSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, turnIndex])
}

// Objetivo del checklist pedagógico (Modo GUIDED)
model SimulationGoal {
  id              String            @id @default(uuid())
  sessionId       String
  description     String            // Qué debe hacer el empleado (ej. "Saludar cordialmente y solicitar DNI")
  order           Int               // Posición en la lista
  isCompleted     Boolean           @default(false)
  completedAtTurn Int?              // En qué turnIndex se consideró cumplido
  evidence        String?           // Breve cita textual que evidenció el cumplimiento

  session         SimulationSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, order])
}

// Devolución formativa final en 3 dimensiones cualitativas
model SimulationFeedback {
  id              String            @id @default(uuid())
  sessionId       String            @unique
  band            PerformanceBand   // Logrado, A mejorar o No logrado
  
  // 3 Tarjetas Cualitativas
  whatWentWell    String            @db.Text // Qué hizo bien con evidencias
  toImprove       String            @db.Text // Aspectos formativos a pulir
  businessRules   String            @db.Text // Evaluación de normas de Credimisión
  
  summary         String            @db.Text // Síntesis general del evaluador
  createdAt       DateTime          @default(now())

  session         SimulationSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}
```

---

## 2. Actualización de Relaciones Existentes

En los modelos ya existentes en `prisma/schema.prisma`:
- `Employee`: Se agrega la relación inversa `simulations SimulationSession[]`.
- `TrainingPill`: Se agrega la relación inversa `simulations SimulationSession[]`.

---

## 3. Máquina de Estados de la Sesión

```
   [ IN_PROGRESS ]
      /       \
     /         \
    v           v
(Completar)   (Abandono tras 24h sin interacción)
    |           |
    v           v
[ COMPLETED ] [ ABANDONED ]
(Genera 3 tarjetas)
```

1. **Creación**: El empleado inicia la simulación (`POST /training/pills/:id/simulations`), el estado arranca en `IN_PROGRESS`.
2. **Intercambio**: Se añaden mensajes alternados (`EMPLOYEE` -> `SIMULATED_CLIENT`). Si es `GUIDED`, se actualizan los `SimulationGoal`.
3. **Cierre**: El empleado presiona "Finalizar Simulación" (`POST /training/simulations/:sessionId/conclude`), el estado pasa a `COMPLETED` y se persiste de manera atómica el registro `SimulationFeedback`.
