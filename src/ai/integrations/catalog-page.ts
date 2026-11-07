import { StockItem } from './ports/stock.port';

export const CATALOG_PAGE_SIZE = 5;
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/televisor(?:es)?|television(?:es)?/g, 'tv')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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
        ![
          'tienen',
          'tenes',
          'hay',
          'hola',
          'quiero',
          'ver',
          'opciones',
          'modelos',
          'productos',
          'de',
          'en',
          'stock',
          'disponibles',
          'catalogo',
        ].includes(word),
    )
    .map((word) => (word.length > 3 ? word.replace(/s$/, '') : word));
  return catalog.filter((item) => {
    if (
      tokens.includes('tv') &&
      !tokens.some((t) => ['soporte', 'accesorio'].includes(t)) &&
      item.category !== 'SMART_TV'
    )
      return false;
    const text = normalize(item.name + ' ' + item.category);
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
