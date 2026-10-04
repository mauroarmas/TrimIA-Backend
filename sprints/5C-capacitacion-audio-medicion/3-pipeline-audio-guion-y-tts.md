# Pre-spec 3 — Pipeline de audio: guion a 2 voces y TTS

**Sprint** 5C · **Orden** 3 de 5 · **Tareas del plan** 5C.3–5C.6
**Depende de** Pre-spec 1 (píldoras de contenido aprobadas) · **Origen** `docs/plan_de_trabajo.md` §Sprint 5C, prototipo Fig 20, RF05

## Qué se quiere

Una pipeline para transformar el texto de una píldora aprobada en un **podcast educativo breve (≤5 minutos)** mediante síntesis de voz con Gemini TTS. Primero se genera un guion a dos voces conversacionales (locutor principal y copresentador con modismos rioplatenses naturales) que el supervisor puede editar. Luego, un worker asíncrono en BullMQ genera el archivo de audio MP3, lo almacena y lo expone vía streaming, registrando el progreso de escucha del empleado (alcanzar el 80% reproducido desbloquea la siguiente etapa).

## Alcance

- **Entra:**
  - Generación del guion a dos locutores usando Gemini (`GEMINI_MODEL`), donde el guion textual actúa directamente como transcripción sincronizada.
  - Interfaz de edición del guion para el supervisor antes de disparar la síntesis.
  - Job en cola BullMQ (`AudioGenerationProcessor`) para invocar el endpoint Gemini TTS con `multiSpeakerVoiceConfig` (2 voces diferenciadas).
  - Conversión de audio (PCM base64 a MP3 optimizado).
  - Almacenamiento local en volumen persistente para desarrollo (`storage/audio/`) con endpoint de streaming HTTP.
  - Registro de avance de reproducción del empleado (`playbackProgressSeconds`, `isCompletedAudio` al 80%).
- **No entra:**
  - Despliegue en Google Cloud Storage (se deja la abstracción preparada mediante interfaz de storage, pero dev corre en disco local).
  - Reconocimiento de voz del usuario (STT de WhatsApp ya fue resuelto en Sprint 5A).
  - Audios extensos (>5 min): las píldoras largas deben dividirse o resumirse para evitar degradación en el modelo TTS.

## Lo que ya existe y hay que reusar

| Necesidad | Ya está | Dónde |
|---|---|---|
| Procesamiento asíncrono en cola | BullMQ + Redis configurado | `src/queue/` |
| Cliente Gemini oficial | `GoogleGenerativeAI` | `src/ai/knowledge/knowledge.service.ts` |
| Modelo de datos de Píldoras | `Pill` | Pre-spec 1 |
| Configuración de variables de entorno | `ConfigService` con validación Joi | `src/config/` |
| Manejo de storage local | Carpeta persistente | `storage/` en raíz |

## Decisiones al especificar

1. **Manejo de cuotas y timeout de TTS:** La generación de audio TTS puede demorar varios segundos y consumir cuota del proveedor. BullMQ debe manejar reintentos con backoff exponencial y estado visible (`AUDIO_PENDING`, `AUDIO_GENERATING`, `AUDIO_READY`, `AUDIO_FAILED`).
2. **Formato y configuración de locutores:** Definir las voces de Gemini TTS para los dos roles (p. ej. `Puck` y `Charon` o equivalentes del catálogo de Gemini) y el prompt de acentuación rioplatense neutral para Misiones.
3. **Mecanismo de validación del 80%:** Si el tracking se reporta periódicamente vía endpoint `POST /training/pills/:id/playback-progress` (con validación de que el tiempo reportado no salte fraudulentamente).
4. **Almacenamiento de audio:** Implementar un servicio desacoplado `AudioStorageService` con implementación local para desarrollo.

## Riesgo principal

El modelo Gemini TTS en versión preview puede tener caídas ocasionales o devolver texto en lugar de audio ante timeouts. El worker de BullMQ debe ser tolerante a fallos, aislar los errores y permitir al supervisor reintentar la generación sin bloquear el resto de la plataforma.

---

## Material de respaldo

### Requisitos asociados
- **RF05**: *"El empleado podrá consultar el contenido en formato de audio, pdf o video."*
- **Tareas del Plan 5C.3–5C.6**:
  - *5C.3: Generación del guion a 2 voces (conversacional, dos locutores, rioplatense).*
  - *5C.4: Generación de audio TTS con Gemini TTS (multiSpeakerVoiceConfig, <=5 min, PCM a MP3, Job BullMQ).*
  - *5C.5: Storage de audio (volumen + endpoint de servido).*
  - *5C.6: Progreso de reproducción (tracking del 80% para desbloquear).*

### Pantalla del prototipo (`docs/prototipos.pdf`)
- **Fig 20 (Píldora Teórica con Audio):** Barra de reproducción con controles de audio (play, pausa, velocidad 1x/1.5x, barra de progreso y transcripción sincronizada).
