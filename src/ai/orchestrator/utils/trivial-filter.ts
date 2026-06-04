/**
 * Pre-filtro de mensajes triviales (saludos/despedidas/cortesías).
 *
 * Se resuelven con una respuesta canned ANTES de tocar cualquier LLM
 * (costo cero tokens). Es el primer paso del ruteo del orquestador.
 */

const GREETING_RE =
  /^\s*(hola+|buenas|buen[oa]s?\s*(d[ií]as?|tardes|noches)?|hey|holis|que\s*tal|qué\s*tal|cómo\s*andan?|como\s*andan?)\s*[!.¿?]*\s*$/i;

const CLOSING_RE =
  /^\s*(gracias|muchas\s*gracias|mil\s*gracias|ok+|oka+|okey+|dale|listo|perfecto|joya|barbaro|bárbaro|chau+|chao|adi[oó]s|nos\s*vemos|hasta\s*luego|👍|🙏|👌)\s*[!.]*\s*$/i;

/** True si el mensaje es un saludo/despedida obvio que no requiere LLM. */
export function isTrivial(message: string): boolean {
  return GREETING_RE.test(message) || CLOSING_RE.test(message);
}

/** Respuesta canned para un mensaje trivial (saludo vs despedida). */
export function cannedReply(message: string): string {
  if (CLOSING_RE.test(message)) {
    return '¡Gracias a vos! Cualquier cosa, escribime. 👋';
  }
  return '¡Hola! 👋 ¿En qué puedo ayudarte hoy?';
}
