# Pre-spec 2 — Diagnóstico inicial y progresión por puesto

**Sprint** 5C · **Orden** 2 de 5 · **Tareas del plan** 5C.10 (y progresión de 5C.1)
**Depende de** Pre-spec 1 (módulos y píldoras modelados) · **Origen** `docs/plan_de_trabajo.md` §Sprint 5C, prototipo Fig 18, RF05

## Qué se quiere

Un mecanismo de **evaluación diagnóstica inicial** rápida (~5 minutos) para empleados nuevos que ingresan a un sector, y las reglas de **desbloqueo progresivo** de los módulos de capacitación. Si el empleado demuestra conocimiento previo en las preguntas clave de un módulo, el sistema marca el módulo como "eximido/aprobado por diagnóstico", evitando hacerle perder tiempo en contenidos operativos que ya domina.

## Alcance

- **Entra:**
  - Banco de preguntas de diagnóstico asociadas a cada módulo formativo.
  - Endpoint para iniciar la prueba diagnóstica y registrar las respuestas del empleado.
  - Algoritmo de evaluación simple (umbral de aciertos) para determinar exención por módulo.
  - Actualización de `EmployeeProgress` con estados `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `EXEMPTED_BY_DIAGNOSTIC`.
  - Reglas de desbloqueo secuencial (la píldora $N+1$ se desbloquea al aprobar la $N$, salvo exención).
- **No entra:**
  - Diagnóstico psicotécnico o de contratación de personal (solo conocimientos operativos internos).
  - Prácticas interactivas con el bot simulador (Pre-spec 4).
  - Generación dinámica de nuevas preguntas de diagnóstico en tiempo real (se configuran sobre las píldoras de la Pre-spec 1).

## Lo que ya existe y hay que reusar

| Necesidad | Ya está | Dónde |
|---|---|---|
| Modelo de módulos y píldoras | `TrainingModule`, `Pill`, `EmployeeProgress` | Pre-spec 1 |
| Sector del empleado | `Employee.sectorId` | `prisma/schema.prisma:175` |
| Preguntas de verificación de píldoras | Campo estructurado en `Pill` | Pre-spec 1 |
| Autenticación del empleado | `JwtAuthGuard` con `req.user` | `src/auth/` |

## Decisiones al especificar

1. **Cantidad y origen de preguntas diagnósticas:** Si se seleccionan automáticamente las preguntas de control de las píldoras del módulo o si el módulo define preguntas diagnósticas dedicadas.
2. **Criterio de exención:** Definir el umbral mínimo (p. ej. 100% o 80% de respuestas correctas en el tema para considerarlo superado sin cursado).
3. **Reversibilidad:** Si un empleado eximido puede de todos modos acceder a consultar y escuchar las píldoras teóricas de ese módulo.
4. **Política ante reprobación del diagnóstico:** No penaliza al empleado; simplemente habilita la ruta de aprendizaje normal desde el inicio.

## Riesgo principal

Si el diagnóstico es muy largo o complejo, genera fricción inicial innecesaria en el onboarding del empleado. Debe ser un test conciso de no más de 5 a 8 preguntas representativas por puesto.

---

## Material de respaldo

### Requisitos asociados
- **RF05**: *"La plataforma deberá asistir a nuevos empleados mediante capacitación que tendrá incluida materiales, gestor de consultas, seguimiento de procesos y simulación activa... El empleado podrá acceder al contenido según su rol."*
- **Tarea 5C.10**: *"Diagnóstico inicial: Test de 5 min que permite saltear contenido ya conocido."*

### Pantalla del prototipo (`docs/prototipos.pdf`)
- **Fig 18 (Inicio de Capacitación):** Muestra el listado de módulos con candados en los módulos bloqueados, etiquetas de "Completado" y barra porcentual de progreso del onboarding del empleado.
