/** Datos explícitos de un formulario activo; nunca inferir identidad de números de precio o SKU. */
export function literalFinancingDetails(message: string) {
  const result: {
    dni?: string;
    name?: string;
    business?: string;
    locality?: string;
  } = {};
  const identity = message
    .trim()
    .match(/^([\p{L}][\p{L} .'’]{2,100})\s*[-–—]\s*(\d{7,8})[.!\s]*$/u);
  const bareDni = message.trim().match(/^\d{7,8}$/);
  if (identity) {
    result.name = identity[1].trim();
    result.dni = identity[2];
  } else if (bareDni) result.dni = bareDni[0];
  const parts = message.split(/\s+[-–—]\s+|[;\n]/).map((p) => p.trim());
  const index = parts.findIndex((p) =>
    /^(?:mi\s+)?(?:comercio|negocio)\b/i.test(p),
  );
  if (index >= 0) {
    const part = parts[index];
    const business = part
      .replace(/^(?:mi\s+)?(?:comercio|negocio)\s*(?::|es\s*:?)\s*/i, '')
      .trim();
    if (
      !/^(?:mi\s+)?(?:comercio|negocio)\b\s*(?::|es\b)?\s*$/i.test(part) &&
      /\p{L}/u.test(business) &&
      business.length <= 160 &&
      !/\b(?:dni|documento)\b/i.test(business)
    )
      result.business = business;
    const locality = parts[index + 1];
    if (locality && /^[\p{L} .'’,]+$/u.test(locality) && locality.length <= 120)
      result.locality = locality;
  }
  return result;
}
