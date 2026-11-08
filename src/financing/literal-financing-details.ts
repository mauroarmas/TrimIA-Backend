/** Datos explícitos de un formulario activo; nunca inferir identidad de números de precio o SKU. */
export function literalFinancingDetails(message: string) {
  const result: {
    dni?: string;
    name?: string;
    business?: string;
    locality?: string;
    productSummary?: string;
    purchaseUse?: 'PERSONAL' | 'BUSINESS';
  } = {};
  if (
    /\b(?:compra personal|uso personal|soy particular|no tengo (?:un )?(?:comercio|negocio)|(?:es |ser[ií]a |lo quiero |la quiero )?para (?:m[ií](?: mismo| misma)?|mi casa|mi hogar))\b/i.test(
      message,
    )
  )
    result.purchaseUse = 'PERSONAL';
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
  // Los formularios con etiquetas tienen valores literales, aunque el modelo
  // normalice comas, tildes o nombres de provincia de una forma distinta.
  const labels = [
    ...message.matchAll(
      /(?:^|[\n;]|[ \t]+(?:[-–—][ \t]+)?)(?:mi[ \t]+)?(nombre(?: y apellido)?|dni|documento|comercio|negocio|localidad|ciudad|modelo|producto)[ \t]*(?::|=|[ \t]+es[ \t]*:?)[ \t]*/giu,
    ),
  ];
  for (let i = 0; i < labels.length; i++) {
    const match = labels[i];
    let value = message
      .slice(
        match.index! + match[0].length,
        labels[i + 1]?.index ?? message.length,
      )
      .trim()
      .replace(/[;\n]+$/g, '')
      .trim();
    if (!value) continue;
    const label = match[1].toLowerCase();
    if (label === 'dni' || label === 'documento') {
      const dni = value.replace(/[. \t]/g, '');
      if (/^\d{7,8}$/.test(dni)) result.dni = dni;
    } else if (/^nombre/.test(label)) {
      if (value.length <= 120 && /\p{L}/u.test(value)) result.name = value;
    } else if (label === 'modelo' || label === 'producto') {
      if (value.length <= 500) result.productSummary = value;
    } else if (label === 'comercio' || label === 'negocio') {
      if (result.locality && value.endsWith(result.locality)) {
        value = value
          .slice(0, -result.locality.length)
          .replace(/\s+[-–—]\s*$/, '')
          .trim();
      }
      if (value.length <= 160) result.business = value;
    } else if (value.length <= 120) result.locality = value;
  }
  return result;
}
