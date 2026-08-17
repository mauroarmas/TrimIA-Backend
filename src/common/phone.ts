/**
 * Normalización de teléfonos argentinos.
 *
 * Forma canónica: `549` + área + número = **13 dígitos**, que es exactamente
 * la que manda Meta en el webhook de WhatsApp. Todo lo que se guarda o se
 * busca en la base pasa por acá, porque un teléfono escrito de dos formas
 * distintas genera un `findUnique` que falla **en silencio**: el empleado
 * queda tratado como cliente y nadie se entera. Ya pasó — quedaron dos filas
 * de Employee para la misma persona (`543865505362` y `5493865505362`).
 *
 * Formatos que se ven en Argentina:
 *   - Internacional móvil:  +54 9 AAAA NNNNNN     (área + número = 10 dígitos)
 *   - Internacional fijo:   +54 AAAA NNNNNN       (sin el 9)
 *   - Local móvil:          0 AAAA 15 NNNNNN
 *
 * Principio de diseño: **lo determinístico se normaliza, lo ambiguo NO se
 * adivina**. Si no se puede derivar la forma canónica con certeza, se
 * devuelve el número tal cual con `canonical: false` y un motivo, para que el
 * llamador lo loguee. Un caso sin cubrir y visible es mejor que uno cubierto
 * por adivinanza y silencioso.
 */

/** Código de país. Credimisión opera solo en Argentina. */
const COUNTRY = '54';

/** Área + número, sin código de país ni el 9 de móvil. */
const NATIONAL_LENGTH = 10;

/** Longitudes válidas de un área argentina. */
const AREA_LENGTHS = [2, 3, 4];

export interface NormalizedPhone {
  /** Forma canónica si se pudo derivar; si no, solo los dígitos del original. */
  phone: string;
  /** `true` si el resultado tiene la forma 549 + 10 dígitos. */
  canonical: boolean;
  /** Por qué no se pudo canonizar. Sólo presente si `canonical` es false. */
  reason?: string;
}

/**
 * Analiza un teléfono y devuelve su forma canónica más el diagnóstico.
 * Idempotente: `analyze(analyze(x).phone).phone === analyze(x).phone`.
 */
export function analyzePhone(raw: string | null | undefined): NormalizedPhone {
  let digits = (raw ?? '').replace(/\D/g, '');

  if (!digits) {
    return { phone: '', canonical: false, reason: 'vacío o sin dígitos' };
  }

  // Prefijo de salida internacional (00 54 ...).
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Código de país.
  if (digits.startsWith(COUNTRY) && digits.length > NATIONAL_LENGTH) {
    digits = digits.slice(COUNTRY.length);
  }

  // El 9 de móvil sólo se saca si lo que queda tiene un largo plausible
  // (10 = ya normalizado, 12 = todavía tiene el 15 local). Ningún área
  // argentina empieza con 9, así que no hay riesgo de comerse un dígito real.
  if (
    digits.startsWith('9') &&
    (digits.length === 11 || digits.length === 13)
  ) {
    digits = digits.slice(1);
  }

  // 0 de discado nacional.
  if (digits.startsWith('0')) digits = digits.slice(1);

  // El 15 local va DESPUÉS del área, y el área mide 2, 3 o 4 dígitos: sin
  // saber cuál es, sacarlo sería adivinar. La única regla firme es que
  // área + número siempre suman 10. Si con eso la posición es única, se saca.
  if (digits.length === NATIONAL_LENGTH + 2) {
    const candidates = AREA_LENGTHS.filter(
      (len) => digits.slice(len, len + 2) === '15',
    );
    if (candidates.length === 1) {
      const at = candidates[0];
      digits = digits.slice(0, at) + digits.slice(at + 2);
    } else if (candidates.length > 1) {
      return {
        phone: digits,
        canonical: false,
        reason: `el 15 podría estar en la posición ${candidates.join(' o ')} — ambiguo, no se toca`,
      };
    }
  }

  if (digits.length !== NATIONAL_LENGTH) {
    return {
      phone: digits,
      canonical: false,
      reason: `quedan ${digits.length} dígitos y se esperaban ${NATIONAL_LENGTH} (¿no es argentino?)`,
    };
  }

  return { phone: `${COUNTRY}9${digits}`, canonical: true };
}

/**
 * Forma canónica del teléfono. Si no se pudo derivar, devuelve los dígitos
 * del original — nunca lanza, para no romper un flujo de mensajería por un
 * número raro. Usá `analyzePhone` cuando quieras loguear el motivo.
 */
export function normalizePhone(raw: string | null | undefined): string {
  return analyzePhone(raw).phone;
}
