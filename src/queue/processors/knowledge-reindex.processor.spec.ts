/**
 * Tests del worker de reindexación — Sprint 5A (US2, FR-024).
 *
 * Lo único que este worker no puede hacer nunca es dejar un documento en
 * `SYNCED` cuando ChromaDB no se actualizó: eso es exactamente la falla
 * silenciosa que el sprint existe para eliminar (el panel muestra una cosa, el
 * agente responde otra, y nada lo delata).
 */
import { Job, UnrecoverableError } from 'bullmq';
import { KnowledgeReindexProcessor } from './knowledge-reindex.processor';

const DOC_ID = '33333333-3333-4333-8333-333333333333';

function buildJob(attemptsMade = 0, attempts = 3) {
  return {
    data: { documentId: DOC_ID },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ documentId: string }>;
}

function buildProcessor() {
  const knowledge = {
    reindex: jest.fn().mockResolvedValue(3),
    markReindexFailed: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new KnowledgeReindexProcessor(knowledge as never);
  // Silencia el logger para no ensuciar la salida de los tests.
  Object.assign(processor, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return { processor, knowledge };
}

describe('KnowledgeReindexProcessor', () => {
  it('reindexa y no marca fallo cuando sale bien', async () => {
    const { processor, knowledge } = buildProcessor();

    await processor.process(buildJob());

    expect(knowledge.reindex).toHaveBeenCalledWith(DOC_ID);
    expect(knowledge.markReindexFailed).not.toHaveBeenCalled();
  });

  it('en un intento intermedio NO marca REINDEX_FAILED todavía', async () => {
    // Marcarlo en el primer fallo llenaría el panel de falsas alarmas por
    // cortes transitorios que el reintento resuelve solo.
    const { processor, knowledge } = buildProcessor();
    knowledge.reindex.mockRejectedValue(new Error('Chroma caído'));

    await expect(processor.process(buildJob(0, 3))).rejects.toThrow(
      'Chroma caído',
    );

    expect(knowledge.markReindexFailed).not.toHaveBeenCalled();
  });

  it('al agotar los reintentos marca REINDEX_FAILED con el motivo', async () => {
    const { processor, knowledge } = buildProcessor();
    knowledge.reindex.mockRejectedValue(new Error('Chroma caído'));

    await expect(processor.process(buildJob(2, 3))).rejects.toThrow(
      'Chroma caído',
    );

    expect(knowledge.markReindexFailed).toHaveBeenCalledWith(
      DOC_ID,
      'Chroma caído',
    );
  });

  it('NUNCA deja el documento en SYNCED cuando la reindexación falló', async () => {
    const { processor, knowledge } = buildProcessor();
    knowledge.reindex.mockRejectedValue(new Error('boom'));

    await expect(processor.process(buildJob(2, 3))).rejects.toThrow();

    // La única vía a SYNCED es reindex() completo; si lanzó, no se llegó ahí.
    expect(knowledge.reindex).toHaveBeenCalled();
    expect(knowledge.markReindexFailed).toHaveBeenCalled();
  });

  it('un documento ya borrado se descarta sin reintentar', async () => {
    const notFound = new Error('Documento no encontrado');
    notFound.name = 'NotFoundException';
    const { processor, knowledge } = buildProcessor();
    knowledge.reindex.mockRejectedValue(notFound);

    await expect(processor.process(buildJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(knowledge.markReindexFailed).not.toHaveBeenCalled();
  });
});
