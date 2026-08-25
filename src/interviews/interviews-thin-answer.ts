/**
 * FR-018a (D5). Barata y asimétrica a propósito: reconoce SOLO el
 * asentimiento vacío — la respuesta completa consiste en muletillas y
 * confirmaciones, sin ninguna palabra con contenido — y ante la duda NO
 * repregunta. Dejar pasar una respuesta pobre es barato (se ve al armar la
 * ficha, en la revisión); repreguntarle a alguien que ya contestó bien no —
 * es la clase de fricción por la que una herramienta interna se deja de usar.
 */

const MULETILLAS = new Set([
  'ok',
  'okay',
  'okey',
  'dale',
  'listo',
  'si',
  'sí',
  'no',
  'nose',
  'se', // "no se" / "no sé": el patrón real más común de respuesta vacía
  'ns',
  'bien',
  'bueno',
  'claro',
  'perfecto',
  'gracias',
  'nada',
  'eso',
  'creo',
]);

export function esAsentimientoVacio(text: string): boolean {
  const palabras = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // sin tildes: "sí" y "si" son la misma muletilla
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (palabras.length === 0) return true;
  return palabras.every((p) => MULETILLAS.has(p));
}
