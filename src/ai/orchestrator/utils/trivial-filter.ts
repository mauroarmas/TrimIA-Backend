/**
 * Pre-filtro de mensajes triviales (saludos/despedidas/cortesías).
 *
 * Se resuelven con una respuesta canned ANTES de tocar cualquier LLM
 * (costo cero tokens). Es el primer paso del ruteo del orquestador.
 */

// El "colchón" de whitespace/puntuación al final va en una sola clase de
// caracteres ([\s!.¿?]*), no en dos \s* separados por el medio: con dos
// grupos independientes de espacios, una cola larga de espacios da
// backtracking cuadrático (agravado si el mensaje no tiene un tope de
// longitud — ver MaxLength en WebhookMessageDto).
const GREETING_RE =
  /^\s*(hola+|buenas|buen[oa]s?\s*(d[ií]as?|tardes|noches)?|hey|holis|que\s*tal|qué\s*tal|cómo\s*andan?|como\s*andan?)[\s!.¿?]*$/i;

const CLOSING_RE =
  /^\s*(gracias|muchas\s*gracias|mil\s*gracias|ok+|oka+|okey+|dale|listo|perfecto|joya|barbaro|bárbaro|chau+|chao|adi[oó]s|nos\s*vemos|hasta\s*luego|👍|🙏|👌)[\s!.]*$/i;

/** True si el mensaje es un saludo/despedida obvio que no requiere LLM. */
export function isTrivial(message: string): boolean {
  return GREETING_RE.test(message) || CLOSING_RE.test(message);
}

/**
 * Marcador que manda n8n cuando no pudo transcribir un audio de WhatsApp
 * (Sprint 5A, US5, FR-009). Contrato entre el Workflow A y este backend —
 * documentado en `n8n/README.md`.
 *
 * Es un centinela improbable a propósito: si fuera algo como "[sin audio]",
 * un usuario podría tipearlo y disparar esta rama a mano. Va en mayúsculas y
 * con doble guion bajo para que no colisione con texto real.
 */
export const UNTRANSCRIBABLE_AUDIO_MARKER = '__AUDIO_NO_TRANSCRIBIBLE__';

/**
 * True si n8n avisó que el audio llegó pero no se entendió.
 *
 * Se compara con el mensaje ya recortado y no con `includes()` sobre el
 * original: si alguien manda el marcador embebido en una frase más larga, eso
 * NO es el aviso de n8n y no debe cortocircuitar el turno.
 */
export function isUntranscribableAudio(message: string): boolean {
  return message.trim() === UNTRANSCRIBABLE_AUDIO_MARKER;
}

export const OPENING_REPLY = '¡Hola! 👋 ¿En qué puedo ayudarte hoy?';
export const CLOSING_REPLY = '¡Gracias a vos! Cualquier cosa, escribime. 👋';

/**
 * Se le pide al usuario que reformule, sin inventar de qué hablaba.
 *
 * Ofrece la salida por texto porque el problema puede ser del audio en sí
 * (ruido, micrófono) y repetir el mensaje hablado daría lo mismo.
 */
export const TRANSCRIPTION_FAILED_REPLY =
  'Recibí tu audio pero no llegué a entenderlo 🙁 ¿Me lo repetís por escrito, ' +
  'o grabás otro hablando un poco más cerca del micrófono?';

/** Respuesta canned para un mensaje que no requiere LLM. */
export function cannedReply(message: string): string {
  if (isUntranscribableAudio(message)) return TRANSCRIPTION_FAILED_REPLY;
  return CLOSING_RE.test(message) ? CLOSING_REPLY : OPENING_REPLY;
}
