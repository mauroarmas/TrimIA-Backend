/**
 * Tests del texto que se vectoriza — spec 006 (US2).
 *
 * El defecto que arreglan: **el título no formaba parte del texto vectorizado**.
 * `ingest()` hacía `chunk(input.content)` y el título viajaba solo en la
 * metadata de Chroma, que no participa de la similitud. Un documento «Sobre
 * Nosotros» cuyo cuerpo no repite la palabra "empresa" competía en desventaja
 * contra la consulta "qué sabés sobre la empresa" frente a documentos que no
 * eran la respuesta — el defecto observado el 2026-08-20.
 *
 * Medido sobre el corpus real (research.md §3): señal +1.3/+3.3 pp, ruido
 * −2.1 pp, y el documento correcto pasa de la posición 3 a la 1.
 *
 * **La distinción que estos tests protegen** es la que más fácil se rompe por
 * descuido:
 *
 *     lo que se VECTORIZA  =  título + fragmento     ← mejora el recall
 *     lo que se DEVUELVE   =  fragmento              ← lo que lee el asistente
 *
 * Si se mezclan, el asistente empieza a leer un texto distinto del que leía y
 * responde distinto, sin que nadie lo haya pedido (FR-006).
 */
import { Audience, KnowledgeSyncStatus } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_ID = '44444444-4444-4444-8444-444444444444';
const TITULO = 'Garantía extendida en electrodomésticos';
const CUERPO = 'Los grandes tienen doce meses desde la fecha de entrega.';

function buildService() {
  const doc = {
    id: DOC_ID,
    title: TITULO,
    content: CUERPO,
    category: 'politica',
    audience: Audience.PUBLICO,
    agentType: 'SALES',
    version: 1,
    isActive: true,
    syncStatus: KnowledgeSyncStatus.SYNCED,
  };

  const collectionAdd = jest.fn().mockResolvedValue({});
  const embedDocuments = jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma: {
      knowledgeDocument: {
        create: jest.fn().mockResolvedValue(doc),
        update: jest.fn().mockResolvedValue(doc),
        findUnique: jest.fn().mockResolvedValue(doc),
        // Spec 007: sin duplicado por defecto — estos tests prueban otra cosa.
        findFirst: jest.fn().mockResolvedValue(null),
      },
    },
    embeddings: { embedDocuments },
    collection: { add: collectionAdd, delete: jest.fn().mockResolvedValue({}) },
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
  });

  return { service, collectionAdd, embedDocuments };
}

const entrada = {
  title: TITULO,
  content: CUERPO,
  category: 'politica',
  audience: Audience.PUBLICO,
};

describe('ingest() — el título entra al vector, no al contenido', () => {
  it('el texto que se vectoriza empieza con el título', async () => {
    const { service, embedDocuments } = buildService();

    await service.ingest(entrada);

    const textos = embedDocuments.mock.calls[0][0] as string[];
    expect(textos).toHaveLength(1);
    expect(textos[0].startsWith(TITULO)).toBe(true);
    expect(textos[0]).toContain(CUERPO);
  });

  it('el contenido que se guarda en Chroma NO lleva el título antepuesto', async () => {
    const { service, collectionAdd } = buildService();

    await service.ingest(entrada);

    // `documents` es lo que `search()` devuelve como `content`, y lo que
    // termina leyendo el asistente. Tiene que quedar exactamente igual que
    // antes de esta spec.
    const documents = collectionAdd.mock.calls[0][0].documents as string[];
    expect(documents).toEqual([CUERPO]);
    expect(documents[0].startsWith(TITULO)).toBe(false);
  });
});

describe('reindex() — aplica la misma regla', () => {
  it('vectoriza con el título y guarda el contenido sin él', async () => {
    const { service, embedDocuments, collectionAdd } = buildService();

    await service.reindex(DOC_ID);

    // Los DOS caminos o ninguno: si solo `ingest` aplicara el título, editar
    // un documento cambiaría en silencio cómo se lo encuentra.
    const textos = embedDocuments.mock.calls[0][0] as string[];
    expect(textos[0].startsWith(TITULO)).toBe(true);

    const documents = collectionAdd.mock.calls[0][0].documents as string[];
    expect(documents).toEqual([CUERPO]);
  });
});

describe('la cantidad de fragmentos no cambia', () => {
  it('anteponer el título no parte el documento en más pedazos', async () => {
    const { service, collectionAdd } = buildService();

    const res = await service.ingest(entrada);

    // El título se antepone DESPUÉS de partir en fragmentos, no antes: si se
    // hiciera al revés, un documento al límite de los 1000 caracteres se
    // partiría distinto y los `ids` dejarían de corresponderse con los que ya
    // están en Chroma.
    expect(res.chunks).toBe(1);
    expect(collectionAdd.mock.calls[0][0].ids).toEqual([`${DOC_ID}:0`]);
  });
});
