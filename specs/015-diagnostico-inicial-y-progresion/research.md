# Research: 015 — Diagnóstico Inicial y Progresión por Puesto

**Feature**: `015-diagnostico-inicial-y-progresion`  
**Fecha**: 2026-10-04  

---

## 1. Selección y Balanceo de Preguntas Diagnósticas

### Decisión
Las preguntas del test diagnóstico inicial se seleccionan de forma determinística y balanceada a partir de las lecciones (`Pill`) en estado `PUBLISHED` asociadas a los módulos activos del sector del empleado y transversales (`sectorId == null`). Se extrae 1 pregunta clave por píldora (o hasta 2 si el módulo tiene pocas píldoras), conformando una evaluación ágil de 5 a 8 preguntas en total.

### Racional
- **Principio II (Cero Alucinación)**: En lugar de generar preguntas en tiempo real mediante un LLM (lo cual agregaría latencia de 3 a 5 segundos, variabilidad e impredecibilidad al examen), se aprovecha el banco de preguntas ya revisado, aprobado y curado por el supervisor en las píldoras de la spec 014.
- **Eficiencia pedagógica (RF05, Tarea 5C.10)**: Un test de 5 a 8 preguntas de opción múltiple toma entre 3 y 5 minutos al empleado, cumpliendo con la restricción de experiencia sin fricción innecesaria.

### Alternativas Descartadas
- *Generación dinámica con Gemini en el momento del request*: Descartada por latencia innecesaria, riesgo de preguntas inconsistentes entre empleados del mismo puesto y costo operativo de tokens.
- *Banco de preguntas diagnóstico completamente separado e independiente de las píldoras*: Descartado porque exigiría al supervisor redactar y mantener dos fuentes de evaluación distintas para los mismos procedimientos operativos.

---

## 2. Criterio de Exención Temática y Algoritmo de Calificación

### Decisión
El cálculo de exención se aplica a **nivel de módulo**. Para que un módulo sea eximido sin cursado:
- El empleado debe responder correctamente el **100%** de las preguntas de ese módulo presentes en el diagnóstico.
- Si un módulo tiene 2 preguntas en el diagnóstico y el empleado acierta ambas, todas las píldoras de ese módulo se marcan en `EmployeeProgress` con el estado `EXEMPTED_BY_DIAGNOSTIC`.
- Si el empleado falla una sola pregunta de ese módulo (acierto < 100%), el módulo NO es eximido y permanece disponible para cursado estándar (`NOT_STARTED`), sin penalización ni reprobación.

### Racional
- **Seguridad Operativa en Credimisión S.R.L.**: Saltear un módulo completo de créditos o cobranzas sin cursar exige certeza de que el empleado conoce los procedimientos clave. Un umbral permisivo (ej. 50%) permitiría a un empleado saltear normativas críticas de cobranza o validación de CBU habiendo adivinado una respuesta.
- **Psicología formativa positiva**: El diagnóstico no se reprueba; simplemente diagnostica el punto óptimo de inicio en el mapa formativo.

### Alternativas Descartadas
- *Exención por píldora individual*: Descartada porque rompería la coherencia pedagógica de los módulos formativos (un módulo no debe quedar con lecciones intermedias huérfanas).
- *Umbral porcentual global (ej. 80% sobre el total)*: Descartado porque un empleado podría saber mucho de un tema y nada de otro, y un umbral global promediaría erróneamente eximiendo temas desconocidos.

---

## 3. Estado de Exención y Desbloqueo Secuencial de Candados

### Decisión
Extender el enum de Prisma `TrainingProgressStatus` con un nuevo valor explícito: `EXEMPTED_BY_DIAGNOSTIC`.
En el cálculo dinámico de candados de lecciones (`getEmployeeModules`):
- Una lección se considera completada a efectos de liberar el candado siguiente (`isLocked: false`) si su registro en `EmployeeProgress` tiene estado `COMPLETED` **O** `EXEMPTED_BY_DIAGNOSTIC`.
- En `getEmployeePill`, si el empleado tiene la lección en estado `EXEMPTED_BY_DIAGNOSTIC`, se permite la lectura libre del material teórico para consultas voluntarias de repaso.

### Racional
- Mantener una distinción nítida entre lo que el empleado estudió y rindió en plataforma (`COMPLETED`) y lo que demostró conocer de antemano (`EXEMPTED_BY_DIAGNOSTIC`). Esto es fundamental para las métricas de efectividad de capacitación de la tesis (OE-11 y entregable E12).

---

## 4. Gobernanza y Seguridad de Supervisión

### Decisión
Los supervisores solo pueden ver y reiniciar diagnósticos de empleados pertenecientes a los sectores que supervisan (`Employee.areasSupervisadas`). Se valida con `KnowledgeService.assertPuedeEscribir(supervisorId, sector.agentType)`.

### Racional
- **Principio I (Confidencialidad por Rol/Sector)**: Ningún supervisor de Ventas debe auditar diagnósticos ni alterar estados de personal de Cobranzas o Administración.
- **Principio III (Humano en el Loop)**: El reinicio de un diagnóstico es una acción administrativa explícita que debe quedar registrada con `resetById` y `resetAt` para trazabilidad de auditoría.
