# Feature Specification: 016 — Pipeline de Audio: Guion a 2 Voces y Síntesis TTS

**Feature Branch**: `016-pipeline-audio-guion-tts`  
**Created**: 2026-10-06  
**Status**: Draft  
**Input**: Pre-spec 3 (`sprints/5C-capacitacion-audio-medicion/3-pipeline-audio-guion-y-tts.md`), Sprint 5C (Capacitación, Audio y Medición), RF05, Tareas 5C.3–5C.6

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generación y Edición del Guion Educativo a 2 Voces (Priority: P1) 🎯 MVP (Parte 1)

Como **supervisor del sector**, quiero generar automáticamente un guion conversacional a dos voces a partir del contenido teórico de una píldora aprobada y poder revisarlo o editarlo, para garantizar que la explicación sea amena, didáctica y adaptada a la cultura de Credimisión antes de producir el audio.

**Why this priority**: El guion es el insumo indispensable para el modelo de síntesis de voz y para la transcripción sincronizada que lee el empleado. La revisión humana previa previene inconsistencias pedagógicas o términos inadecuados (Principio III: Humano en el Loop).

**Independent Test**: Invocar el generador de guion para una píldora con contenido teórico; verificar que devuelve una estructura de diálogo alternado entre dos locutores con lenguaje claro y modismos rioplatenses naturales de la región, y que el supervisor puede modificar parlamentos y guardar los cambios.

**Acceptance Scenarios**:
1. **Given** una píldora formativa con estado `PUBLISHED`, **When** el supervisor solicita generar el guion conversacional, **Then** el sistema produce un diálogo de dos personajes con duración estimada menor o igual a 5 minutos, guardándolo asociado a la píldora en estado de borrador de guion.
2. **Given** un guion generado automáticamente, **When** el supervisor edita los parlamentos de los personajes y guarda los cambios, **Then** el guion actualizado queda persistido y listo para iniciar la síntesis sonora.
3. **Given** un supervisor que intenta generar o editar el guion de una píldora de un sector ajeno al que supervisa, **Then** el sistema deniega la operación con un error de autorización de sector (Principio I).

---

### User Story 2 — Síntesis Asíncrona de Audio TTS y Almacenamiento Local (Priority: P1) 🎯 MVP (Parte 2)

Como **supervisor**, quiero disparar la síntesis de voz del guion aprobado para que se genere un podcast educativo breve en formato estándar (MP3) sin congelar la aplicación ni interrumpir a otros usuarios mientras se procesa.

**Why this priority**: La síntesis de voz requiere tiempo de procesamiento y llamadas a modelos de IA; el procesamiento desacoplado en segundo plano (Principio IV) garantiza latencia inmediata en la API y resiliencia ante cortes o demoras del proveedor.

**Independent Test**: Solicitar la generación de audio tras aprobar el guion; verificar que la petición responde de inmediato con confirmación de encolado, que el worker asíncrono procesa la síntesis con dos voces diferenciadas, convierte el resultado a MP3 en el almacenamiento persistente, y actualiza el estado de la píldora a disponible con streaming funcional.

**Acceptance Scenarios**:
1. **Given** una píldora con guion listo, **When** el supervisor solicita generar el audio, **Then** la API encola la tarea en background, responde inmediatamente con estado en proceso (`AUDIO_PENDING`), y el worker asume la síntesis.
2. **Given** la tarea en proceso por el worker, **When** la síntesis de dos voces finaliza satisfactoriamente, **Then** el archivo MP3 queda almacenado en el volumen persistente de la plataforma, se calcula la duración exacta y la píldora pasa a estado listo (`AUDIO_READY`).
3. **Given** un audio listo, **When** se solicita la reproducción desde el navegador o reproductor, **Then** el sistema sirve el flujo de audio mediante streaming HTTP compatible con pausas y saltos de reproducción.

---

### User Story 3 — Reproducción y Desbloqueo Adaptativo al 80% (Priority: P2)

Como **empleado en capacitación**, quiero escuchar el podcast explicativo de la píldora con controles de reproducción y transcripción sincronizada, de modo que al escuchar la mayor parte de la lección se registre mi progreso y se desbloquee la siguiente etapa.

**Why this priority**: Cierra el circuito pedagógico del estudiante: ofrece un canal auditivo alternativo al texto (RF05) y valida que el empleado haya asimilado el material antes de avanzar.

**Independent Test**: Iniciar la reproducción del audio como empleado autenticado; reportar el avance en segundos de escucha y verificar que al superar el 80% de la duración total la lección registra el audio como completado, liberando la continuidad formativa.

**Acceptance Scenarios**:
1. **Given** un empleado visualizando una píldora con audio disponible, **When** reproduce el archivo, **Then** puede pausar, reanudar y visualizar en pantalla el texto del guion correspondiente a cada locutor.
2. **Given** un empleado escuchando el podcast, **When** alcanza el 80% del tiempo total reproducido de manera secuencial y consistente, **Then** el sistema marca el requisito auditivo de la lección como cumplido (`isAudioCompleted: true`).
3. **Given** un intento fraudulento de saltar inmediatamente al final del audio sin haber transcurrido el tiempo real, **Then** el sistema rechaza el salto temporal excesivo y no otorga la aprobación anticipada.

---

### User Story 4 — Resiliencia ante Fallos y Reintento de Síntesis (Priority: P3)

Como **supervisor**, quiero ser notificado si la síntesis de audio falla (por cuota de servicio, timeout o error de red) y tener la posibilidad de reintentar la producción sin perder el guion ni romper la píldora teórica.

**Why this priority**: El modelo TTS en entornos de desarrollo o previews puede experimentar intermitencias; el sistema debe ser tolerante a fallas sin requerir intervención técnica en la base de datos.

**Independent Test**: Simular un fallo en el proveedor de síntesis durante el trabajo de fondo; verificar que la píldora pasa a estado de fallo (`AUDIO_FAILED`), registra el motivo del error, y permite al supervisor solicitar un reintento limpio desde la interfaz.

**Acceptance Scenarios**:
1. **Given** un error durante la síntesis en background, **When** el worker agota sus reintentos automáticos, **Then** la píldora queda marcada con estado `AUDIO_FAILED` y el contenido teórico permanece intacto y legible.
2. **Given** una píldora en estado `AUDIO_FAILED`, **When** el supervisor pulsa reintentar generación, **Then** la tarea se vuelve a encolar con el guion existente y el estado vuelve a `AUDIO_PENDING`.

---

## Edge Cases

- **Píldoras extensas (>5 minutos):** Si el contenido de la píldora supera las palabras límite equivalentes a 5 minutos hablados (~750 palabras), el generador de guion debe resumir los conceptos clave para mantener la síntesis dentro de la ventana de rendimiento y foco pedagógico.
- **Solicitud duplicada de generación:** Si un supervisor solicita generar audio mientras ya existe un trabajo en progreso para esa misma píldora, la API debe devolver conflicto o el estado actual sin duplicar jobs en la cola.
- **Acceso concurrente al streaming:** Múltiples empleados reproduciendo el mismo audio deben servirse mediante streaming de rangos (`Range: bytes=...`) eficiente sin bloquear el hilo principal.
- **Eliminación o archivado de píldoras con audio:** Al archivar o regenerar un audio, el archivo físico anterior debe limpiarse ordenadamente para evitar fugas de almacenamiento en disco.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE generar un guion pedagógico a dos voces (Locutor A y Locutor B) a partir del contenido de una píldora publicada, con tono conversacional natural y modismos rioplatenses acordes a la región de Misiones.
- **FR-002**: El sistema DEBE permitir al supervisor editar, guardar y validar el texto de cada parlamento del guion antes de autorizar la síntesis de voz.
- **FR-003**: El sistema DEBE encolar la síntesis de audio en un procesador asíncrono en segundo plano, respondiendo a la solicitud HTTP de inmediato sin retener la conexión del cliente.
- **FR-004**: El procesador de fondo DEBE invocar el servicio de síntesis de voz con configuración de dos voces diferenciadas asignadas a cada locutor del guion.
- **FR-005**: El sistema DEBE convertir la salida del modelo de voz a formato MP3 estándar optimizado y guardarla en el almacenamiento persistente del entorno.
- **FR-006**: El sistema DEBE proveer un endpoint de streaming HTTP de audio con soporte para cabeceras `Range` para permitir reproducción inmediata, pausas y reanudación eficiente en navegadores.
- **FR-007**: El sistema DEBE registrar el avance de escucha de cada empleado (`playbackProgressSeconds`), validando que los incrementos de tiempo sean consistentes con el transcurso del tiempo real.
- **FR-008**: El sistema DEBE marcar automáticamente el audio como completado cuando el empleado acumula al menos el 80% de reproducción legítima de la duración total.
- **FR-009**: El sistema DEBE manejar el ciclo de vida del audio mediante estados claros: `NOT_REQUESTED`, `SCRIPT_GENERATED`, `AUDIO_PENDING`, `AUDIO_GENERATING`, `AUDIO_READY` y `AUDIO_FAILED`.
- **FR-010**: El sistema DEBE exigir validación de sector (`assertPuedeEscribir`) para la generación de guiones, edición y solicitud de síntesis de voz, restringiendo la acción a supervisores autorizados para dicho sector.

---

### Key Entities

- **Guion de Audio (`AudioScript`)**:
  - Estructura ordenada de parlamentos asociados a la píldora.
  - Contiene el personaje/locutor (`voiceRole`: LOCUTOR_1 / LOCUTOR_2), el texto hablado, y el orden secuencial.
- **Audio de Píldora (`PillAudio`)**:
  - Registro de los metadatos del archivo de audio asociado a la píldora formativa.
  - Campos: identificador, ruta o clave del archivo, duración en segundos, formato/mime, estado de procesamiento (`AUDIO_PENDING`, `AUDIO_READY`, `AUDIO_FAILED`), error de fallo si aplica, y fecha de generación.
- **Progreso Auditivo del Empleado (`EmployeeAudioProgress`)**:
  - Relación entre el empleado y la píldora.
  - Registra los segundos reproducidos acumulados, el porcentaje relativo alcanzado y la marca booleana de completitud (`isAudioCompleted`).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: La generación del guion conversacional se completa en menos de 10 segundos desde la solicitud del supervisor.
- **SC-002**: La API responde a la orden de sintetizar audio en menos de 300 ms, derivando el trabajo a segundo plano.
- **SC-003**: El podcast resultante no excede los 5 minutos de duración (300 segundos) para maximizar la retención cognitiva del empleado.
- **SC-004**: El streaming de audio inicia la reproducción en el navegador en menos de 1 segundo en condiciones de red estándar.
- **SC-005**: El 100% de los empleados que escuchan de forma continua al menos el 80% del audio reciben el registro de lección aprobada sin demoras ni recargas forzadas.
- **SC-006**: Ningún fallo temporal en el servicio de síntesis de voz bloquea o interrumpe la navegación del resto de la plataforma, permitiendo reintentos limpios.

---

## Assumptions

- El entorno de desarrollo utiliza el volumen persistente montado en Docker (`storage/audio/`) detrás de un servicio desacoplado (`AudioStorageService`), dejando lista la interfaz para conectar Google Cloud Storage en entornos productivos.
- Las dos voces utilizadas corresponden a locutores diferenciados (femenina/masculina o timbres contrastantes) para generar dinámica de diálogo atractiva.
- El guion de audio generado sirve en sí mismo como transcripción accesible para empleados que prefieran o requieran lectura complementaria.
- El avance al 80% desbloquea la progresión o el cuestionario de verificación según la configuración pedagógica del módulo.
