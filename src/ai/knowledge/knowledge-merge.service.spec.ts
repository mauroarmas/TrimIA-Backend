/**
 * Tests de la fusión con aprobación (spec 008, US1).
 *
 * La garantía central es negativa, igual que en `knowledge-ai-edit.service.spec.ts`:
 * el `preview` **no escribe nada**. Que sea imposible fusionar sin aprobación no
 * puede depender de que alguien se acuerde de la regla (Principio III).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeMergeService } from './knowledge-merge.service';

const KEEP = {
  id: 'keep-1',
  title: 'Documento que sobrevive',
  content: 'contenido A',
  version: 3,
  isActive: true,
  agentType: 'SALES',
};
const ABSORB = {
  id: 'absorb-1',
  title: 'Documento absorbido',
  content: 'contenido B',
  version: 1,
  isActive: true,
  agentType: 'SALES',
};

function buildService(
  opts: {
    invokeResult?: Record<string, unknown> | Error;
    pair?: Record<string, unknown> | null;
  } = {},
) {
  const pair =
    opts.pair === undefined
      ? {
          id: 'pair-1',
          documentAId: KEEP.id,
          documentBId: ABSORB.id,
          documentA: KEEP,
          documentB: ABSORB,
        }
      : opts.pair;

  const prisma = {
    hygienePair: {
      findUnique: jest.fn().mockResolvedValue(pair),
    },
  };

  const invoke = jest.fn();
  const respuesta = opts.invokeResult ?? {
    proposedContent: 'contenido fusionado completo',
    summary: 'Se incorporó lo que aportaba el segundo documento.',
    changedSections: [
      { before: 'contenido A', after: 'contenido fusionado completo' },
    ],
    confident: true,
  };
  if (respuesta instanceof Error) invoke.mockRejectedValue(respuesta);
  else invoke.mockResolvedValue(respuesta);

  const knowledgeUpdate = jest
    .fn()
    .mockResolvedValue({ id: KEEP.id, version: KEEP.version + 1 });
  const knowledgeSetActive = jest
    .fn()
    .mockResolvedValue({ id: ABSORB.id, isActive: false });
  const assertPuedeEscribir = jest.fn().mockResolvedValue(undefined);

  const knowledge = {
    update: knowledgeUpdate,
    setActive: knowledgeSetActive,
    assertPuedeEscribir,
  };

  const service = new KnowledgeMergeService(
    prisma as never,
    { chat: { withStructuredOutput: () => ({ invoke }) } } as never,
    knowledge as never,
  );

  return {
    service,
    prisma,
    invoke,
    knowledge,
    knowledgeUpdate,
    knowledgeSetActive,
    assertPuedeEscribir,
  };
}

describe('preview — no persiste nada (FR-007)', () => {
  it('genera la propuesta sin tocar knowledge.update ni setActive', async () => {
    const { service, knowledgeUpdate, knowledgeSetActive } = buildService();

    const result = await service.preview('pair-1', KEEP.id, 'emp-1');

    expect(result.proposedContent).toBe('contenido fusionado completo');
    expect(result.keepDocumentId).toBe(KEEP.id);
    expect(result.absorbDocumentId).toBe(ABSORB.id);
    expect(knowledgeUpdate).not.toHaveBeenCalled();
    expect(knowledgeSetActive).not.toHaveBeenCalled();
  });

  it('devuelve la versión del que sobrevive, para detectar carreras', async () => {
    const { service } = buildService();

    const result = await service.preview('pair-1', KEEP.id, 'emp-1');

    expect(result.baseVersion).toBe(KEEP.version);
  });

  it('403 SIN llamar al modelo si no es responsable del área (FR-011)', async () => {
    const { service, assertPuedeEscribir, invoke } = buildService();
    assertPuedeEscribir.mockRejectedValue(
      new ForbiddenException('Solo sos responsable de: Cobranzas'),
    );

    await expect(service.preview('pair-1', KEEP.id, 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('404 si el par no existe', async () => {
    const { service } = buildService({ pair: null });

    await expect(
      service.preview('inexistente', KEEP.id, 'emp-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('404 si alguno de los dos documentos ya no está activo', async () => {
    const absorbInactivo = { ...ABSORB, isActive: false };
    const { service } = buildService({
      pair: {
        id: 'pair-1',
        documentAId: KEEP.id,
        documentBId: ABSORB.id,
        documentA: KEEP,
        documentB: absorbInactivo,
      },
    });

    await expect(service.preview('pair-1', KEEP.id, 'emp-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('confident:false devuelve el contenido del que sobrevive SIN TOCAR', async () => {
    const { service } = buildService({
      invokeResult: {
        proposedContent: KEEP.content,
        summary: 'Los documentos se contradicen.',
        changedSections: [],
        confident: false,
      },
    });

    const result = await service.preview('pair-1', KEEP.id, 'emp-1');

    expect(result.confident).toBe(false);
    expect(result.proposedContent).toBe(KEEP.content);
    expect(result.changedSections).toEqual([]);
  });
});

describe('apply — guarda el content del body, nunca uno regenerado (FR-008)', () => {
  it('llama a update() con el content del body y mergedFromDocumentId', async () => {
    const { service, knowledgeUpdate } = buildService();

    await service.apply(
      'pair-1',
      {
        keepDocumentId: KEEP.id,
        baseVersion: KEEP.version,
        content: 'texto corregido a mano',
      },
      'emp-1',
    );

    expect(knowledgeUpdate).toHaveBeenCalledWith(
      KEEP.id,
      expect.objectContaining({
        content: 'texto corregido a mano',
        mergedFromDocumentId: ABSORB.id,
        expectedVersion: KEEP.version,
      }),
      'emp-1',
    );
  });

  it('llama a update() ANTES que a setActive() (orden crítico)', async () => {
    const { service, knowledgeUpdate, knowledgeSetActive } = buildService();
    const orden: string[] = [];
    knowledgeUpdate.mockImplementation(async () => {
      orden.push('update');
      return { id: KEEP.id, version: 4 };
    });
    knowledgeSetActive.mockImplementation(async () => {
      orden.push('setActive');
      return { id: ABSORB.id, isActive: false };
    });

    await service.apply(
      'pair-1',
      { keepDocumentId: KEEP.id, baseVersion: KEEP.version, content: 'x' },
      'emp-1',
    );

    expect(orden).toEqual(['update', 'setActive']);
  });

  it('desactiva el documento absorbido, no el que sobrevive', async () => {
    const { service, knowledgeSetActive } = buildService();

    await service.apply(
      'pair-1',
      { keepDocumentId: KEEP.id, baseVersion: KEEP.version, content: 'x' },
      'emp-1',
    );

    expect(knowledgeSetActive).toHaveBeenCalledWith(ABSORB.id, false, 'emp-1');
  });

  it('un fallo del setActive NO revierte el update ya aplicado', async () => {
    const { service, knowledgeUpdate, knowledgeSetActive } = buildService();
    knowledgeSetActive.mockRejectedValue(new Error('Chroma no responde'));

    await expect(
      service.apply(
        'pair-1',
        { keepDocumentId: KEEP.id, baseVersion: KEEP.version, content: 'x' },
        'emp-1',
      ),
    ).rejects.toThrow('Chroma no responde');

    // El update ya se aplicó y no hay ningún "undo" del contenido fusionado.
    expect(knowledgeUpdate).toHaveBeenCalled();
  });

  it('assertPuedeEscribir se chequea sobre LOS DOS documentos', async () => {
    const { service, assertPuedeEscribir } = buildService();

    await service.apply(
      'pair-1',
      { keepDocumentId: KEEP.id, baseVersion: KEEP.version, content: 'x' },
      'emp-1',
    );

    expect(assertPuedeEscribir).toHaveBeenCalledWith('emp-1', KEEP.agentType);
    expect(assertPuedeEscribir).toHaveBeenCalledWith('emp-1', ABSORB.agentType);
  });

  it('404 si el documento a absorber ya fue desactivado por otra fusión', async () => {
    const { service } = buildService({
      pair: {
        id: 'pair-1',
        documentAId: KEEP.id,
        documentBId: ABSORB.id,
        documentA: KEEP,
        documentB: { ...ABSORB, isActive: false },
      },
    });

    await expect(
      service.apply(
        'pair-1',
        { keepDocumentId: KEEP.id, baseVersion: KEEP.version, content: 'x' },
        'emp-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
