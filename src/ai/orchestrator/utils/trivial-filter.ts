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

export const OPENING_REPLY = '¡Hola! 👋 ¿En qué puedo ayudarte hoy?';
export const CLOSING_REPLY = '¡Gracias a vos! Cualquier cosa, escribime. 👋';

/** Respuesta canned para un mensaje trivial (saludo vs despedida). */
export function cannedReply(message: string): string {
  return CLOSING_RE.test(message) ? CLOSING_REPLY : OPENING_REPLY;
}
