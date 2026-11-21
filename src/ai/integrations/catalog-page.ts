import { StockItem } from './ports/stock.port';

export const CATALOG_PAGE_SIZE = 5;
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bcortar\s+fiambres?\b/g, 'cortadora fiambre')
    .replace(/\btelevisor(?:es)?|television(?:es)?|tele(?:s)?\b/g, 'tv')
    .replace(/\bpulgadas?\b/g, '')
    .replace(/(\d)\s+mm\b/g, '$1mm')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const stemWord = (word: string) => {
  if (word.length > 4 && word.endsWith('ores')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
};

/** Una elección explícita de un modelo completo no vuelve a ser una consulta de familia. */
export function explicitCatalogSelection(
  catalog: StockItem[],
  message: string,
  history?: { role: string; content: string }[],
) {
  const trimmed = message.trim();
  const numbered = trimmed.match(
    /^(?:(?:quiero|elijo|prefiero|me quedo con|me interesa|me gusta|dame)\s+)?(?:(?:la|el)\s+)?(?:opci[oó]n\s*|n[uú]mero\s*|nro\.?\s*|#\s*)?([1-9]\d*)[.!?\s]*$/i,
  );
  if (numbered && history?.length) {
    const chosenNum = Number(numbered[1]);
    const lastAssistantWithList = [...history]
      .reverse()
      .find(
        (turn) =>
          turn.role === 'ASSISTANT' &&
          new RegExp(`(?:^|\\n)${chosenNum}\\.\\s+`).test(turn.content),
      );
    if (lastAssistantWithList) {
      const lineMatch = lastAssistantWithList.content.match(
        new RegExp(`(?:^|\\n)${chosenNum}\\.\\s+([^—\\n]+)`),
      );
      if (lineMatch?.[1]) {
        const lineName = normalize(lineMatch[1]);
        const byLine = catalog.filter(
          (item) => normalize(item.name) === lineName,
        );
        if (byLine.length === 1) return byLine[0];
      }
    }
  }
  const selection = trimmed.match(
    /^(?:quiero|elijo|prefiero|me quedo con|me interesa|me gusta)\s+(?:(?:(la|el|una|un|opci[oó]n))\s+)?(.+?)[.!\s]*$/i,
  );
  if (!selection) return undefined;
  const article = (selection[1] || '').toLowerCase();
  const value = normalize(selection[2]);
  const matches = catalog.filter(
    (item) => normalize(item.name) === value || normalize(item.sku) === value,
  );
  if (matches.length === 1) return matches[0];
  // Si usa artículo definido (la/el/opción) o menciona marca/medida específica que identifica un único modelo
  if (article !== 'una' && article !== 'un') {
    const tokens = value
      .split(' ')
      .filter(
        (t) =>
          t.length > 1 &&
          ![
            'la',
            'el',
            'de',
            'del',
            'para',
            'con',
            'por',
            'modelo',
            'opcion',
            'producto',
          ].includes(t),
      )
      .map(stemWord);
    if (tokens.length >= 2) {
      const tokenMatches = catalog.filter((item) => {
        const words = normalize(item.name).split(' ').map(stemWord);
        return tokens.every((t) =>
          words.some(
            (w) =>
              w === t ||
              ((t.length > 3 || /^\d+$/.test(t)) && w.startsWith(t)),
          ),
        );
      });
      if (tokenMatches.length === 1) return tokenMatches[0];
    }
  }
  return undefined;
}

/** Busca todos los modelos; una consulta de familia nunca toma solo el primero. */
export function searchCatalog(catalog: StockItem[], query: string) {
  const exact = catalog.find(
    (item) => item.sku.toLowerCase() === query.toLowerCase(),
  );
  if (exact) return [exact];
  const tokens = normalize(query)
    .split(' ')
    .filter(
      (word) =>
        word.length > 1 &&
        ![
          'tienen',
          'tenes',
          'hay',
          'hola',
          'quiero',
          'quisiera',
          'busco',
          'necesito',
          'ver',
          'opciones',
          'modelos',
          'productos',
          'maquina',
          'maquinas',
          'equipo',
          'equipos',
          'aparato',
          'para',
          'una',
          'uno',
          'un',
          'la',
          'el',
          'las',
          'los',
          'de',
          'del',
          'en',
          'con',
          'por',
          'stock',
          'disponibles',
          'disponible',
          'catalogo',
          'financiar',
          'financiacion',
          'financien',
          'comprar',
          'precio',
          'precios',
        ].includes(word),
    )
    .map(stemWord);
  if (tokens.length === 0) return [];
  return catalog.filter((item) => {
    if (
      tokens.includes('tv') &&
      !tokens.some((t) => ['soporte', 'accesorio'].includes(t)) &&
      item.category !== 'SMART_TV'
    )
      return false;
    const text = normalize(item.name + ' ' + item.category)
      .split(' ')
      .map(stemWord)
      .join(' ');
    return tokens.every((token) => text.includes(token));
  });
}

export function formatCatalogPage(items: StockItem[], offset = 0) {
  const page = items.slice(offset, offset + CATALOG_PAGE_SIZE);
  const money = (value: number) => '$' + value.toLocaleString('es-AR');
  return (
    'Estas son las opciones del catálogo de prueba:\n' +
    page
      .map(
        (item, index) =>
          `${offset + index + 1}. ${item.name} — ${item.stock > 0 ? 'disponible' : 'sin stock'}. ` +
          (item.listPrice === null
            ? 'Precio a confirmar'
            : `Lista: ${money(item.listPrice)}`) +
          (item.cashPrice === null
            ? ''
            : `; contado: ${money(item.cashPrice)}`) +
          (item.urlCredimision ? `\n${item.urlCredimision}` : ''),
      )
      .join('\n') +
    (items.length > offset + page.length
      ? '\nTengo más opciones. Si querés verlas, decime «mostrame más». '
      : '\n') +
    '¿Cuál modelo te interesa?'
  );
}
