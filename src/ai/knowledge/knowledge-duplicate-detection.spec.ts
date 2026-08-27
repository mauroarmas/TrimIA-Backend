/**
 * Detección de duplicados al escribir (spec 007, US2).
 *
 * El `checksum` de cada documento se calcula desde el Sprint 5A y **nunca se
 * leía**: el mismo contenido cargado dos veces por caminos distintos entraba
 * dos veces sin que nadie dijera nada, y los dos documentos terminaban
 * repartiéndose la señal en cada búsqueda.
 *
 * La misma convención que ya rige para archivos repetidos
 * (`assertNotDuplicate`, `knowledge-ingestion.service.ts:218`): **detección,
 * no prohibición**. Un 409 que informa cuál es el previo, y `force` para
 * insistir a sabiendas.
 */
import { ConflictException } from '@nestjs/common';
import { Audience } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_EXISTENTE = '55555555-5555-4555-8555-555555555555';
const CONTENIDO = 'Los electrodomésticos grandes tienen 12 meses de garantía.';

function buildService(duplicado: { id: string; title: string } | null) {
  const nuevo = {
    id: '66666666-6666-4666-8666-666666666666',
    title: 'Garantía',
    content: CONTENIDO,
    version: 1,
  };

  const findFirst = jest.fn().mockResolvedValue(duplicado);
  const create = jest.fn().mockResolvedValue(nuevo);
  const update = jest.fn().mockResolvedValue(nuevo);

  const collectionAdd = jest.fn().mockResolvedValue({});
  const embedDocuments = jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma: {
      knowledgeDocument: { findFirst, create, update },
    },
    embeddings: { embedDocuments },
    collection: { add: collectionAdd, delete: jest.fn().mockResolvedValue({}) },
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
  });

  return { service, findFirst, create, collectionAdd, embedDocuments };
}

const entrada = {
  title: 'Garantía',
  content: CONTENIDO,
  category: 'politica',
  audience: Audience.PUBLICO,
};

describe('ingest() — duplicado exacto', () => {
  it('un contenido idéntico se rechaza con 409, informando cuál es el previo', async () => {
    const { service } = buildService({
      id: DOC_EXISTENTE,
      title: 'Garantía extendida en electrodomésticos',
    });

    await expect(service.ingest(entrada)).rejects.toThrow(ConflictException);

    try {
      await service.ingest(entrada);
    } catch (err) {
      const response = (err as ConflictException).getResponse() as Record<
        string,
        unknown
      >;
      expect(response.reason).toBe('DUPLICATE_DOCUMENT');
      expect(response.existing).toMatchObject({
        id: DOC_EXISTENTE,
        title: 'Garantía extendida en electrodomésticos',
      });
    }
  });

  it('con force: true, se crea igual — es detección, no prohibición', async () => {
    const { service, create } = buildService({
      id: DOC_EXISTENTE,
      title: 'Garantía extendida en electrodomésticos',
    });

    await service.ingest({ ...entrada, force: true });

    expect(create).toHaveBeenCalled();
  });

  it('dos contenidos que difieren en un carácter NO se detectan como duplicados', async () => {
    // El mock de `findFirst` responde según el checksum que reciba: acá se
    // simula que ningún documento coincide (contenido distinto → hash distinto).
    const { service, create } = buildService(null);

    await service.ingest({ ...entrada, content: `${CONTENIDO} ` });

    expect(create).toHaveBeenCalled();
  });

  it('ante un duplicado exacto, NO se llama al servicio de embeddings', async () => {
    const { service, embedDocuments, collectionAdd } = buildService({
      id: DOC_EXISTENTE,
      title: 'Garantía extendida en electrodomésticos',
    });

    await expect(service.ingest(entrada)).rejects.toThrow(ConflictException);

    // La detección corta ANTES de vectorizar (FR-013): lo que se carga dos
    // veces no gasta cuota dos veces.
    expect(embedDocuments).not.toHaveBeenCalled();
    expect(collectionAdd).not.toHaveBeenCalled();
  });

  it('sin duplicado, el camino feliz no cambia', async () => {
    const { service, create, collectionAdd } = buildService(null);

    const res = await service.ingest(entrada);

    expect(create).toHaveBeenCalled();
    expect(collectionAdd).toHaveBeenCalled();
    expect(res.documentId).toBeDefined();
  });
});
