/**
 * Aviso de documentos parecidos al cargar (spec 007, US3).
 *
 * A diferencia del duplicado exacto (US2), acá el contenido NO es idéntico
 * pero cubre el mismo tema con otras palabras — el defecto real del
 * 2026-08-20: «Sobre Nosotros» y «Qué es Credimisión», cargados con 19
 * minutos de diferencia, se repartían la señal y ninguno alcanzaba el umbral.
 *
 * **No bloquea nada** (FR-015): el documento se crea igual, el aviso solo
 * acompaña. Y el umbral es el que calibró `scripts/calibrar-parecido.ts`
 * (`KNOWLEDGE_SIMILARITY_THRESHOLD`), no el del RAG — comparan cosas distintas.
 */
import { Audience } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_PARECIDO = '77777777-7777-4777-8777-777777777777';
const UMBRAL = 0.75;

function buildService(
  hits: { documentId: string; title: string; content: string; score: number }[],
) {
  const nuevo = {
    id: '88888888-8888-4888-8888-888888888888',
    title: 'Sobre Nosotros',
    content: 'Somos una empresa de electrodomésticos.',
    version: 1,
  };

  const create = jest.fn().mockResolvedValue(nuevo);
  const update = jest.fn().mockResolvedValue(nuevo);
  const findFirst = jest.fn().mockResolvedValue(null); // sin duplicado exacto
  const findMany = jest
    .fn()
    .mockResolvedValue(
      hits.map((h) => ({ id: h.documentId, audience: Audience.PUBLICO })),
    );

  const embeddings = {
    embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };

  const collectionAdd = jest.fn().mockResolvedValue({});
  const collectionQuery = jest.fn().mockResolvedValue({
    documents: [hits.map((h) => h.content)],
    metadatas: [
      hits.map((h) => ({ documentId: h.documentId, title: h.title })),
    ],
    distances: [hits.map((h) => 1 - h.score)],
  });

  const config = {
    get: jest.fn().mockReturnValue(UMBRAL),
  };

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma: { knowledgeDocument: { create, update, findFirst, findMany } },
    embeddings,
    collection: {
      add: collectionAdd,
      delete: jest.fn().mockResolvedValue({}),
      query: collectionQuery,
    },
    config,
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
  });

  return { service, create, findMany, collectionAdd };
}

const entrada = {
  title: 'Sobre Nosotros',
  content: 'Somos una empresa de electrodomésticos.',
  category: 'general',
  audience: Audience.PUBLICO,
};

describe('ingest() — documentos parecidos (no idénticos)', () => {
  it('sobre un tema ya cubierto, devuelve similarDocuments con título y score', async () => {
    const { service } = buildService([
      {
        documentId: DOC_PARECIDO,
        title: 'Qué es Credimisión',
        content: 'La empresa vende electrodomésticos.',
        score: 0.78,
      },
    ]);

    const res = await service.ingest(entrada);

    expect(res.similarDocuments).toHaveLength(1);
    expect(res.similarDocuments![0]).toMatchObject({
      documentId: DOC_PARECIDO,
      title: 'Qué es Credimisión',
      score: 0.78,
    });
  });

  it('ordenados de más a menos parecido', async () => {
    const { service } = buildService([
      { documentId: 'doc-a', title: 'A', content: 'x', score: 0.76 },
      { documentId: 'doc-b', title: 'B', content: 'y', score: 0.9 },
    ]);

    const res = await service.ingest(entrada);

    expect(res.similarDocuments!.map((d) => d.documentId)).toEqual([
      'doc-b',
      'doc-a',
    ]);
  });

  it('sobre un tema nuevo, devuelve similarDocuments vacío', async () => {
    // Todos los hits quedan por debajo del umbral (0.75).
    const { service } = buildService([
      {
        documentId: DOC_PARECIDO,
        title: 'Otro tema',
        content: 'z',
        score: 0.5,
      },
    ]);

    const res = await service.ingest(entrada);

    expect(res.similarDocuments).toEqual([]);
  });

  it('con parecidos detectados, el documento SE CREA IGUAL — el aviso no bloquea', async () => {
    const { service, create } = buildService([
      { documentId: DOC_PARECIDO, title: 'Parecido', content: 'x', score: 0.9 },
    ]);

    await service.ingest(entrada);

    expect(create).toHaveBeenCalled();
  });

  /**
   * `search()` ya excluye desactivados vía `activeFilter` — este test confirma
   * que `buscarParecidos` no reintroduce documentos que search() ya descartó,
   * no que haga un filtro propio.
   */
  it('no informa un documento que search() ya excluyó por estar desactivado', async () => {
    // Simula que ChromaDB no devuelve nada (como pasaría con el filtro real).
    const { service } = buildService([]);

    const res = await service.ingest(entrada);

    expect(res.similarDocuments).toEqual([]);
  });

  it('marca como audienciaDistinta un parecido con otra audiencia (FR-020)', async () => {
    const { service, findMany } = buildService([
      { documentId: DOC_PARECIDO, title: 'Interno', content: 'x', score: 0.9 },
    ]);
    findMany.mockResolvedValue([
      { id: DOC_PARECIDO, audience: Audience.INTERNO },
    ]);

    const res = await service.ingest({
      ...entrada,
      audience: Audience.PUBLICO,
    });

    expect(res.similarDocuments![0].audienciaDistinta).toBe(true);
  });

  it('misma audiencia: audienciaDistinta es false', async () => {
    const { service, findMany } = buildService([
      { documentId: DOC_PARECIDO, title: 'Público', content: 'x', score: 0.9 },
    ]);
    findMany.mockResolvedValue([
      { id: DOC_PARECIDO, audience: Audience.PUBLICO },
    ]);

    const res = await service.ingest({
      ...entrada,
      audience: Audience.PUBLICO,
    });

    expect(res.similarDocuments![0].audienciaDistinta).toBe(false);
  });
});
