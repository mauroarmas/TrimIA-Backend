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
    /^(?:es\s+|ser[ií]a\s+)?(?:personal|particular|familiar|hogar|para mi casa|para mi hogar)[.!?\s]*$/i.test(
      message.trim(),
    ) ||
    /\b(?:compra personal|uso personal|uso familiar|es personal|ser[ií]a personal|consumidor final|soy particular|no tengo (?:un )?(?:comercio|negocio|local)|sin (?:comercio|negocio|local)|(?:es |ser[ií]a |lo quiero |la quiero )?para (?:m[ií](?: mismo| misma)?|mi casa|mi hogar|mi domicilio|uso personal|uso familiar))\b/i.test(
      message,
    )
  )
    result.purchaseUse = 'PERSONAL';
  const identity = message
    .trim()
    .match(
      /^([\p{L}][\p{L} .'’]{2,100})\s*(?:[-–—]|,)\s*(?:dni\s*[:=]?\s*)?(\d{7,8})[.!\s]*$/iu,
    );
  const bareDni = message.trim().match(/^\d{7,8}$/);
  if (
    identity &&
    !/\b(?:quiero|quisiera|busco|necesito|cuesta|precio|heladera|cortadora|balanza|horno|amasadora|sobadora|freidora|freezer|tv|televisor|smart|comercio|negocio|local|almac[eé]n|kiosco)\b/i.test(
      identity[1],
    )
  ) {
    result.name = identity[1]
      .replace(
        /^(?:hola[,.\s]+|buenas[,.\s]+|buen d[ií]a[,.\s]+)?(?:me llamo|soy|mi nombre(?:\s+completo|\s+y\s+apellido)?(?:\s+es)?\s*[:=]?)\s+/i,
        '',
      )
      .trim();
    result.dni = identity[2];
  } else if (bareDni) result.dni = bareDni[0];
  const parts = message.split(/\s+[-–—]\s+|[;\n]/).map((p) => p.trim());
  const index = parts.findIndex((p) =>
    /^(?:mi\s+)?(?:comercio|negocio|local)\b/i.test(p),
  );
  if (index >= 0) {
    const part = parts[index];
    let business = part
      .replace(
        /^(?:mi\s+)?(?:comercio|negocio|local)\s*(?::|=|(?:es|se llama)\s*:?)\s*/i,
        '',
      )
      .trim();
    const partInLoc = business.match(
      /^(.+?)(?:,?\s+(?:(?:y\s+)?(?:vivo|soy|estoy|queda|ubicad[oa])\s+)?en\s+|,\s+(?:y\s+)?soy\s+de\s+)([\p{L}][\p{L} .'’,]{2,60})$/iu,
    );
    if (partInLoc) {
      business = partInLoc[1].trim();
      if (!result.locality) result.locality = partInLoc[2].trim();
    }
    if (
      !/^(?:mi\s+)?(?:comercio|negocio|local)\b\s*(?::|=|(?:es|se llama)\b)?\s*$/i.test(
        part,
      ) &&
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
      /(?:^|[\n;,]|[ \t]+(?:[-–—][ \t]+)?)(?:mi[ \t]+)?(nombre(?: completo| y apellido)?|dni|documento|comercio|negocio|local|localidad|ciudad|modelo|producto)[ \t]*(?::|=|[ \t]+(?:es|se llama)[ \t]*:?)[ \t]*/giu,
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
      .replace(/[,;\n]+$/g, '')
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
    } else if (
      label === 'comercio' ||
      label === 'negocio' ||
      label === 'local'
    ) {
      if (result.locality && value.endsWith(result.locality)) {
        value = value
          .slice(0, -result.locality.length)
          .replace(
            /(?:\s+[-–—]|,?\s+(?:(?:y\s+)?(?:vivo|soy|estoy|queda|ubicad[oa])\s+)?en|,\s+(?:y\s+)?soy\s+de)\s*$/i,
            '',
          )
          .trim();
      }
      const inLoc = value.match(
        /^(.+?)(?:,?\s+(?:(?:y\s+)?(?:vivo|soy|estoy|queda|ubicad[oa])\s+)?en\s+|,\s+(?:y\s+)?soy\s+de\s+)([\p{L}][\p{L} .'’,]{2,60})$/iu,
      );
      if (inLoc) {
        value = inLoc[1].trim();
        if (!result.locality) result.locality = inLoc[2].trim();
      }
      if (value.length <= 160) result.business = value;
    } else if (value.length <= 120) result.locality = value;
  }
  if (!result.name) {
    const naturalName = message.match(
      /\b(?:me llamo|mi nombre(?:\s+completo|\s+y\s+apellido)?\s+es)\s+([\p{L}][\p{L} .'’]{2,80}?)(?=$|[.,;\n]|\s+(?:y\s+)?(?:mi\s+)?(?:dni|documento|soy|vivo|tengo|comercio|negocio|local\b))/iu,
    );
    if (naturalName?.[1]?.trim()) result.name = naturalName[1].trim();
  }
  if (!result.dni && result.name) {
    const labeledDni = message
      .match(
        /\b(?:dni|documento)(?:\s+(?:es|n[uú]mero|nro))?[\s:º°.-]*(\d[\d. ]{5,12}\d)(?!\d)/i,
      )?.[1]
      ?.replace(/\D/g, '');
    if (labeledDni && /^\d{7,8}$/.test(labeledDni)) result.dni = labeledDni;
  }
  if (!result.locality) {
    const naturalLoc = message.match(
      /\b(?:(?:soy|vivo)\s+en|soy\s+de|vivo\s+en\s+la\s+(?:ciudad|localidad)\s+de)\s+([\p{L}][\p{L} .'’,]{2,80}?)(?=$|[.;\n]|\s+(?:y\s+)?(?:mi\s+)?(?:dni|documento|nombre|comercio|negocio|local\b))/iu,
    );
    if (naturalLoc?.[1]?.trim()) result.locality = naturalLoc[1].trim();
  }
  return result;
}
