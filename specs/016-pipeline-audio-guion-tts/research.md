# Research & Technical Decisions: 016 — Pipeline de Audio: Guion a 2 Voces y Síntesis TTS

**Feature**: [spec.md](./spec.md)  
**Status**: Completed  
**Date**: 2026-10-06  

---

## Decision 1: Generación del Guion a Dos Voces con LLM Estructurado

### Contexto
Para transformar el texto denso de una píldora formativa en un podcast didáctico (≤5 minutos), se requiere un diálogo dinámico entre dos locutores:
- **Locutor 1 (Conductor/a Principal)**: Tono cálido, guía pedagógico, explica conceptos centrales y directivas de la empresa.
- **Locutor 2 (Copresentador/a)**: Aporta preguntas prácticas, plantea dudas habituales del día a día con modismos rioplatenses naturales de la región (Misiones), ejemplifica situaciones con clientes.

### Decisión
Utilizar el modelo configurado en `GEMINI_MODEL` a través del cliente oficial de Google GenAI (`@google/genai`) ya integrado en `src/ai/knowledge/knowledge.service.ts` con **Structured Outputs (JSON Schema)**:
```typescript
export interface DialogueLine {
  speaker: 'SPEAKER_1' | 'SPEAKER_2';
  text: string;
}

export interface AudioScriptPayload {
  title: string;
  estimatedDurationSeconds: number;
  dialogue: DialogueLine[];
}
```

### Rationale
El formato JSON estructurado garantiza que el guion siempre sea parseable, que los turnos de diálogo estén estrictamente tipados y que el supervisor pueda renderizar y editar cada línea en la interfaz de forma individual.

### Alternativas Consideradas
- *Texto plano con separadores como "Locutor 1: ...":* Descartado por fragilidad al parsear y riesgo de errores sintácticos en edición.
- *Un solo locutor monologal:* Descartado; el diálogo a dos voces mejora significativamente la retención cognitiva y la escucha activa en capacitaciones cortas.

---

## Decision 2: Arquitectura del Motor TTS (Síntesis de Voz Multilocutor)

### Contexto
Se requiere sintetizar audio de alta fidelidad asignando una voz diferente a cada locutor (`SPEAKER_1` y `SPEAKER_2`), generando un archivo final continuo en formato MP3 o WAV optimizado para web.

### Decisión
Diseñar un puerto desacoplado `TtsService` con implementación `GeminiTtsService`:
- Configuración de dos voces contrastantes (ej. Timbre A: tono narrativo sobrio; Timbre B: tono conversacional expresivo).
- En caso de que la cuota del proveedor no esté disponible o en pruebas locales/unitarias, se implementa un adaptador de fallback con generación sintética estructurada o mock determinístico que produce un audio válido con duración proporcional al conteo de palabras (~150 palabras/minuto).

### Rationale
Respeta el **Principio V (Arquitectura Modular y Desacoplada)**: la lógica del worker y del reproductor no conoce la API del proveedor de voz; si en el futuro se migra de Gemini TTS a Google Cloud TTS o ElevenLabs, solo se actualiza el adaptador `TtsService`.

---

## Decision 3: Procesamiento Asíncrono en Background con BullMQ (Principio IV)

### Contexto
La síntesis de voz puede demorar entre 5 y 25 segundos dependiendo de la longitud del guion y la latencia del proveedor de IA. Si se ejecutara en el ciclo síncrono del request HTTP, generaría timeouts en proxies, bloqueos de conexión y experiencia de usuario degradada.

### Decisión
Registrar una cola dedicada `'training-audio'` en BullMQ gestionada con Redis:
- El endpoint `POST /training/pills/:id/audio/generate` valida los permisos, actualiza el estado de la píldora a `AUDIO_PENDING`, encola el job y devuelve `202 Accepted` de inmediato.
- El worker `AudioGenerationProcessor` toma el job, pasa el estado a `AUDIO_GENERATING`, procesa el audio, lo almacena y lo marca como `AUDIO_READY`.
- Reintentos: 3 intentos con backoff exponencial. Si agota los intentos, captura el error y marca la píldora en `AUDIO_FAILED` sin tumbar el servicio.

### Rationale
Cumple taxativamente con el **Principio IV (Procesamiento Asíncrono y Resiliente)** de la constitución de TrimIA: cero trabajo pesado en el request HTTP.

---

## Decision 4: Almacenamiento Persistente (`AudioStorageService`) y Streaming HTTP

### Contexto
Los audios generados deben persistir entre reinicios de contenedores y servirse de manera fluida a los empleados sin cargar archivos enteros en memoria RAM.

### Decisión
- **Almacenamiento**: Crear `AudioStorageService` con implementación `LocalStorageService` que guarda los archivos en el volumen persistente `storage/audio/` (`storage/audio/<pillId>-<timestamp>.mp3`). La ruta o clave se persiste en la entidad de base de datos.
- **Streaming**: El endpoint `GET /training/pills/:id/audio` implementa soporte nativo para encabezados HTTP `Range` (`bytes=start-end`), respondiendo con código `206 Partial Content`, `Accept-Ranges: bytes` y `Content-Range`.

### Rationale
El soporte de `Range` es el estándar de la industria web para reproductores HTML5 (`<audio>`), permitiendo saltos de reproducción ("scrubbing"), buffering instantáneo y bajo consumo de ancho de banda.

---

## Decision 5: Verificación del Umbral del 80% y Detección de Avance Fraudulento

### Contexto
El requisito 5C.6 y RF05 exige que escuchar al menos el 80% del audio desbloquee la progresión o el cuestionario, pero debe prevenirse que un usuario salte el reproductor al final en 2 segundos para falsear la asistencia.

### Decisión
- Endpoint: `POST /training/pills/:id/playback-progress` recibe `{ currentSeconds: number }`.
- Validación antifraude:
  - Se almacena `playbackProgressSeconds` y la estampa `lastReportedAt`.
  - El nuevo valor reportado `currentSeconds` no puede superar a `playbackProgressSeconds + (ahora - lastReportedAt) + 5s (margen de jitter)`.
  - Si un salto reportado excede esa ventana física, se actualiza la posición del reproductor pero el tiempo computado acumulado solo avanza al ritmo del tiempo real transcurrido.
- Al alcanzar `currentSeconds >= audioDurationSeconds * 0.80`, se marca `isAudioCompleted = true` en `EmployeeProgress`.

---

## Decision 6: Control de Gobernanza y Permisos por Sector (Principio I y III)

### Contexto
Solo supervisores autorizados pueden generar guiones, modificarlos y autorizar la producción de audio.

### Decisión
- Los endpoints de generación de guion, guardado de guion y generación de audio invocan `KnowledgeService.assertPuedeEscribir(supervisorId, pill.module.sector.agentType)` asegurando que supervisores de un área no modifiquen el material de otra.
