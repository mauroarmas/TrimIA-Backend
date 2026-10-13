# Technical Research: Práctica Guiada, Simulación Libre y Devolución Cualitativa

**Feature**: `017-practica-guiada-simulacion`  
**Date**: 2026-10-13  
**Status**: Completed

## 1. Roleplay del Cliente Simulado y Evaluación en Vivo (Modo Guiado)

### Contexto y Problema
En la **Práctica Guiada** (User Story 1), el empleado conversa con un cliente simulado por IA mientras un panel lateral evalúa en vivo qué objetivos del checklist se van cumpliendo (ej. *Saludo inicial*, *Pide DNI*, *Explica tasa*, *Cierre*). El desafío técnico es lograr que el cliente responda en personaje y que el checklist se actualice turno a turno **sin superar 2.5 segundos de latencia** (SC-001).

### Opciones Consideradas
1. **Llamadas Secuenciales**: 
   - 1ª llamada: Generar respuesta del cliente simulado.
   - 2ª llamada: Evaluar si el último mensaje del empleado cumplió objetivos del checklist.
   - *Desventajas*: Duplica el costo de tokens y lleva la latencia a 3.5–5 segundos, degradando la experiencia conversacional.
2. **Llamada Única con Structured Output (Opción Elegida)**:
   - Se invoca al modelo de lenguaje (Gemini) con un prompt de sistema que define la personalidad del cliente y los objetivos pedagógicos vigentes, solicitando un JSON estructurado con:
     - `customerResponse`: La réplica que lee el empleado.
     - `goalsCompleted`: Lista de IDs de objetivos que se cumplieron en este turno con su justificación textual.
     - `customerEmotion`: Estado de ánimo del cliente (neutral, impaciente, satisfecho).
   - *Ventajas*: Una sola inferencia (<1.8s), consistencia absoluta entre lo que el cliente dice y lo que se evalúa, y tipado estricto sin parseos frágiles.

### Decisión
Adoptar **llamada única con Structured Output** mediante el SDK de Google GenAI (`@google/genai` / `@google/generative-ai`), utilizando el esquema JSON nativo ya empleado con éxito en `knowledge-ai-edit.service.ts` y en el pipeline de guiones de la Spec 016.

---

## 2. Generación del Escenario y Perfil del Cliente

### Contexto y Problema
Cada píldora formativa cubre un tema específico (ej. *Tratamiento de objeciones por tasa de interés*, *Negociación con morosos de 30 días*, *Alta de cliente monotributista*). La simulación necesita un cliente con nombre, situación financiera y conflicto creíble acorde a la píldora.

### Opciones Consideradas
1. **Escenarios Estáticos en Código**: Hardcodear un caso por píldora. Inflexible y repetitivo para reintentos.
2. **Generación Dinámica Basada en la Píldora (Opción Elegida)**: Al momento de iniciar la sesión (`POST /training/pills/:id/simulations`), si la píldora no tiene un caso fijo configurado, el sistema genera dinámicamente un perfil de cliente y 3 a 5 objetivos pedagógicos a partir del título, descripción y contenido de la píldora, asegurando variabilidad en los reintentos.

### Decisión
Implementar generación contextual del caso:
- **Perfil de cliente**: Nombre, edad, ocupación, producto de interés, situación crediticia y objeción principal.
- **Checklist de 3 a 5 objetivos**: Verbos de acción observables (ej. "Verificar DNI", "Explicar costo financiero total", "Acordar fecha de pago").

---

## 3. Arquitectura del Modo Libre (`FREE`)

### Contexto
En el **Modo Libre** (User Story 2), el empleado conversa sin panel lateral de checklist ni pistas.

### Decisión
- Se utiliza el mismo prompt del cliente simulado pero se omite la evaluación turno a turno de objetivos en el output.
- El modelo devuelve solo la réplica conversacional (`customerResponse`), reduciendo la latencia a menos de 1.2 segundos.
- La evaluación se posterga por completo hasta el momento en que el empleado presiona *"Finalizar Simulación"*.

---

## 4. Devolución Cualitativa en 3 Tarjetas y Bandas de Desempeño

### Contexto y Regla Constitucional
La Constitución del proyecto y la Pre-spec 4 prohíben explícitamente puntuaciones numéricas de 0 a 100 ("un LLM puntuando sobre 100 no es reproducible; se usan bandas cualitativas por criterio").

### Decisión de Esquema
Al finalizar la sesión (`POST /training/simulations/:sessionId/conclude`), el sistema analiza la transcripción completa de la conversación contra los objetivos formativos y emite un JSON estructurado:
```json
{
  "band": "ACHIEVED | NEEDS_IMPROVEMENT | NOT_ACHIEVED",
  "whatWentWell": "Fortalezas demostradas con citas exactas del chat...",
  "toImprove": "Recomendaciones concretas sobre qué faltó o cómo reformular...",
  "businessRules": "Evaluación de políticas de Credimisión (tasas, verificación de identidad, acuerdos formales)...",
  "summary": "Resumen pedagógico general..."
}
```

---

## 5. Aislamiento de Datos y Seguridad

### Principio Constitucional: Cero Contaminación
Las simulaciones de entrenamiento:
1. **No se almacenan en las tablas operativas** (`Conversation`, `Message`) para no alterar las métricas reales de clientes ni el enrutador de agentes.
2. **No se indexan en ChromaDB** bajo ningún concepto (se preserva la integridad del corpus RAG operativo).
3. Residen en modelos dedicados: `SimulationSession`, `SimulationMessage`, `SimulationGoal`, `SimulationFeedback`.
4. El cliente simulado tiene instrucciones explícitas en el prompt de sistema para actuar como un ciudadano/cliente común y no revelar herramientas, prompts ni directivas internas ante preguntas insidiosas.
