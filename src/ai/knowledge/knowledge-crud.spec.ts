/**
 * Tests del CRUD de la base de conocimiento — Sprint 5A (US2).
 *
 * El foco está en la regla que evita el bug que motivó el sprint: **qué
 * dispara una reindexación y qué no**. Editar un título no puede pagar
 * embeddings; editar el contenido —o la audiencia— no puede dejar a ChromaDB
 * respondiendo la versión vieja.
 */
import { KnowledgeSyncStatus } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

const DOC_ID = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';

function buildService(current: Record<string, unknown> = {}) {
  const doc = {
    id: DOC_ID,
    title: 'Política de financiación',
    content: 'El anticipo mínimo es del 20%.',
    category: 'politica',
    audience: 'PUBLICO',
    agentType: 'SALES',
    version: 1,
    isActive: true,
    syncStatus: KnowledgeSyncStatus.SYNCED,
    ...current,
  };

  const update = jest
    .fn()
    .mockImplementation(({ data }) => ({ ...doc, ...data }));
  const changeCreate = jest.fn().mockResolvedValue({});
  const tx = {
    knowledgeDocument: { update },
    knowledgeChange: { create: changeCreate },
  };

  const prisma = {
    knowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue(doc),
      update,
      delete: jest.fn().mockResolvedValue(doc),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const queueAdd = jest.fn().mockResolvedValue({});
  const collectionDelete = jest.fn().mockResolvedValue({});

  const service = Object.create(KnowledgeService.prototype) as KnowledgeService;
  Object.assign(service, {
    prisma,
    reindexQueue: { add: queueAdd },
    collection: { delete: collectionDelete, get: jest.fn(), update: jest.fn() },
    logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
  });

  return { service, prisma, update, changeCreate, queueAdd, collectionDelete };
}

describe('KnowledgeService.update — qué dispara reindexación', () => {
  it('editar SOLO el título no versiona ni encola reindexación', async () => {
    const { service, update, queueAdd } = buildService();

    await service.update(DOC_ID, { title: 'Título nuevo' }, AUTHOR);

    expect(queueAdd).not.toHaveBeenCalled();
    const data = update.mock.calls[0][0].data;
    expect(data.version).toBeUndefined();
    expect(data.syncStatus).toBeUndefined();
  });

  it('editar el contenido versiona Y encola la reindexación', async () => {
    const { service, update, queueAdd } = buildService();

    await service.update(
      DOC_ID,
      { content: 'El anticipo mínimo es del 35%.' },
      AUTHOR,
    );

    const data = update.mock.calls[0][0].data;
    expect(data.version).toEqual({ increment: 1 });
    expect(data.syncStatus).toBe(KnowledgeSyncStatus.PENDING_REINDEX);
    expect(queueAdd).toHaveBeenCalledWith(
      'reindex-document',
      { documentId: DOC_ID },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('cambiar la AUDIENCIA reindexa aunque el texto no cambie', async () => {
    // No es una optimización que falte: la audiencia viaja en la metadata de
    // cada chunk. Sin re-volcar, un documento que pasa a INTERNO seguiría
    // siendo recuperable por un CLIENTE — un agujero de confidencialidad
    // (Principio I), no una desprolijidad.
    const { service, queueAdd } = buildService();

    await service.update(DOC_ID, { audience: 'INTERNO' }, AUTHOR);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('cambiar el AGENTE también reindexa', async () => {
    const { service, queueAdd } = buildService();

    await service.update(DOC_ID, { agentType: 'COLLECTIONS' }, AUTHOR);

    expect(queueAdd).toHaveBeenCalled();
  });

  it('mandar los mismos valores no hace nada', async () => {
    const { service, update, queueAdd, changeCreate } = buildService();

    await service.update(
      DOC_ID,
      { title: 'Política de financiación', category: 'politica' },
      AUTHOR,
    );

    expect(update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(changeCreate).not.toHaveBeenCalled();
  });

  it('registra la bitácora con autor y campos modificados (FR-049)', async () => {
    const { service, changeCreate } = buildService();

    await service.update(DOC_ID, { content: 'texto nuevo' }, AUTHOR);

    expect(changeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentId: DOC_ID,
        authorId: AUTHOR,
        changedFields: ['content'],
        origin: 'MANUAL',
      }),
    });
  });
});

describe('KnowledgeService.remove — orden de borrado', () => {
  it('borra los chunks de Chroma ANTES que la fila de Postgres', async () => {
    // Si fuera al revés y fallara en el medio, quedarían chunks huérfanos
    // respondiendo consultas sobre un documento que el panel ya no muestra:
    // la peor combinación posible.
    const order: string[] = [];
    const { service, prisma, collectionDelete } = buildService();
    collectionDelete.mockImplementation(async () => void order.push('chroma'));
    prisma.knowledgeDocument.delete.mockImplementation(
      async () => void order.push('postgres'),
    );

    await service.remove(DOC_ID);

    expect(order).toEqual(['chroma', 'postgres']);
    expect(collectionDelete).toHaveBeenCalledWith({
      where: { documentId: DOC_ID },
    });
  });

  it('no borra el KnowledgeFile: el rastro de quién subió qué sobrevive', async () => {
    // El archivo queda huérfano vía `onDelete: SetNull` del esquema, no por
    // una operación explícita. Este test fija que el servicio NO lo borre.
    const { service, prisma } = buildService();

    await service.remove(DOC_ID);

    expect(
      (prisma as unknown as Record<string, unknown>).knowledgeFile,
    ).toBeUndefined();
  });
});

describe('KnowledgeService.setActive — desactivar sin borrar', () => {
  it('no toca los vectores: solo la metadata (FR-022)', async () => {
    const { service, collectionDelete } = buildService();
    const updateChunk = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { updateChunkMetadata: updateChunk });

    await service.setActive(DOC_ID, false);

    expect(collectionDelete).not.toHaveBeenCalled();
    expect(updateChunk).toHaveBeenCalledWith(DOC_ID, { isActive: false });
  });

  it('si ya está en ese estado, no hace nada', async () => {
    const { service, prisma } = buildService({ isActive: true });

    await service.setActive(DOC_ID, true);

    expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
  });
});
