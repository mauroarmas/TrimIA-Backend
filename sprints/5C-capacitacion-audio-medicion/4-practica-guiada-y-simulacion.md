# Pre-spec 4 — Práctica guiada, simulación libre y feedback cualitativo

**Sprint** 5C · **Orden** 4 de 5 · **Tareas del plan** 5C.7–5C.9
**Depende de** Pre-spec 1 (objetivos y píldoras) · **Origen** `docs/plan_de_trabajo.md` §Sprint 5C, prototipos Fig 21–22, RF05

## Qué se quiere

Un simulador conversacional para que el empleado ponga en práctica lo aprendido atendiendo a un **cliente simulado por IA**. Soporta dos modalidades: **Práctica Guiada** (con un panel lateral que evalúa en vivo un checklist de objetivos cumplidos por el empleado mediante structured output) y **Simulación Libre** (entorno limpio sin ayudas en tiempo real). Al concluir la sesión, el sistema genera una devolución pedagógica en **3 tarjetas cualitativas** (*Qué hizo bien*, *A mejorar*, *Reglas del negocio*) con bandas de desempeño (*Logrado*, *A mejorar*, *No logrado*), evitando puntuaciones numéricas arbitrarias de 0 a 100.

## Alcance

- **Entra:**
  - Modelo de sesión de simulación (`SimulationSession`, `SimulationMessage`, `SimulationFeedback`).
  - Rol de cliente simulado: el LLM asume la personalidad de un cliente con un caso específico (nombre, producto, situación crediticia, tono) derivado de la píldora.
  - Modo Guiado: evaluación turno a turno con checklist en vivo de objetivos cumplidos (Structured Output).
  - Modo Libre: conversación completa sin feedback intermedio.
  - Evaluación final en 3 dimensiones cualitativas y resumen formativo.
  - Endpoints para iniciar simulación, intercambiar mensajes y solicitar cierre/evaluación.
- **No entra:**
  - Canales reales externos (la interfaz recrea un chat tipo WhatsApp/Web únicamente en el frontend).
  - Puntuaciones numéricas sobre 100 (un LLM puntuando sobre 100 no es reproducible; se usan bandas cualitativas por criterio).
  - Modificación del corpus RAG con los mensajes de la simulación (las simulaciones quedan aisladas de la base de conocimiento operativa).

## Lo que ya existe y hay que reusar

| Necesidad | Ya está | Dónde |
|---|---|---|
| Infraestructura conversacional | Modelos de mensajes y sesiones | `src/messaging/` |
| Orquestación con LangGraph | Grafo base de agentes | `src/ai/agents/shared/rag-agent.graph.ts` |
| Structured Output con Gemini | Invocación con esquema JSON | `src/ai/knowledge/knowledge-ai-edit.service.ts` |
| Contexto del empleado y su sector | Token JWT y `Employee` | `src/auth/` |

## Decisiones al especificar

1. **Definición de escenarios de simulación:** Si los escenarios de roleplay se generan dinámicamente desde el contenido de la píldora teórica o si se configuran plantillas de casos por módulo.
2. **Evaluación en vivo sin latencia excesiva:** En la práctica guiada, cómo estructurar la llamada para que el cliente simulado responda y simultáneamente devuelva el estado del checklist sin duplicar llamadas ni demorar el mensaje más de 2 segundos.
3. **Criterios de finalización:** Si la simulación termina automáticamente cuando se cumplen todos los objetivos del checklist o si el empleado decide cuándo cerrar la práctica.
4. **Almacenamiento y privacidad:** Las conversaciones simuladas pertenecen al legajo de capacitación del empleado y solo son visibles para él y su supervisor.

## Riesgo principal

Si el agente que simula al cliente se "sale del personaje" o contesta con conocimiento técnico interno en vez de comportarse como un cliente real de Credimisión, la práctica pierde valor pedagógico. El prompt del simulador debe anclar estrictamente su rol y restringir el acceso al conocimiento corporativo interno.

---

## Material de respaldo

### Requisitos asociados
- **RF05**: *"La plataforma deberá asistir a nuevos empleados mediante capacitación que tendrá incluida materiales, gestor de consultas, seguimiento de procesos y simulación activa."*
- **Tareas del Plan 5C.7–5C.9**:
  - *5C.7: Práctica Guiada (rol de cliente + panel con checklist en vivo).*
  - *5C.8: Simulación Libre (mismo mecanismo sin panel).*
  - *5C.9: Feedback final (3 tarjetas, bandas cualitativas Logrado / A mejorar / No logrado).*

### Pantallas del prototipo (`docs/prototipos.pdf`)
- **Fig 21 (Práctica Guiada):** Ventana de chat central con panel lateral derecho mostrando objetivos del proceso: "1. Saludo inicial", "2. Solicitud de DNI", "3. Validación crediticia", con tildes verdes automáticos conforme avanza la charla.
- **Fig 22 (Simulación Libre):** Pantalla limpia de chat con botón de "Finalizar Simulación" y posterior despliegue de las 3 tarjetas de retroalimentación cualitativa.
