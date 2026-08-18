/**
 * Tests de "editar con la IA" — Sprint 5A (US6, FR-030..FR-033).
 *
 * La garantía central es negativa y por eso hay que fijarla con tests: el
 * `preview` **no escribe nada**. Que sea imposible aplicar un cambio sin
 * aprobación no debería depender de que alguien se acuerde de la regla, sino
 * de que el código que persiste no exista en ese camino (Principio III).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { KnowledgeAiEditService } from './knowledge-ai-edit.service';

const DOC_ID = '99999999-9999-4999-8999-999999999999';
const AUTOR = '22222222-2222-4222-8222-222222222222';
const ORIGINAL = 'El anticipo mínimo es del 20% para todos los productos.';
const PROPUESTO = 'El anticipo mínimo es del 30% para todos los productos.';

function buildService(
  respuesta: Record<string, unknown> | Error = {
    proposedContent: PROPUESTO,
    summary: 'Se actualizó el anticipo mínimo de 20% a 30%.',
    changedSections: [{ before: 'del 20%', after: 'del 30%' }],
    confident: true,
  },
  version = 3,
) {
  const invoke = jest.fn();
  if (respuesta instanceof Error) invoke.mockRejectedValue(respuesta);
  else invoke.mockResolvedValue(respuesta);

  const prisma = {
    knowledgeDocument: {
      findUnique: jest.fn().mockResolvedValue({
        id: DOC_ID,
        title: 'Política de financiación',
        content: ORIGINAL,
        version,
      }),
      // Presente a propósito: si el preview lo llamara, el test lo detecta.
      update: jest.fn(),
    },
  };
  const knowledgeUpdate = jest
    .fn()
    .mockResolvedValue({ id: DOC_ID, version: 4 });

  const service = new KnowledgeAiEditService(
    prisma as never,
    { chat: { withStructuredOutput: () => ({ invoke }) } } as never,
    { update: knowledgeUpdate } as never,
  );
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });

  return { service, prisma, invoke, knowledgeUpdate };
}

describe('preview — no toca el documento (FR-032)', () => {
  it('tras un preview exitoso, nada se escribió en la base', async () => {
    const { service, prisma, knowledgeUpdate } = buildService();

    const result = await service.preview(DOC_ID, 'el anticipo pasa a 30%');

    expect(result.proposedContent).toBe(PROPUESTO);
    expect(prisma.knowledgeDocument.update).not.toHaveBeenCalled();
    expect(knowledgeUpdate).not.toHaveBeenCalled();
  });

  it('devuelve la versión sobre la que trabajó, para poder detectar carreras', async () => {
    const { service } = buildService(undefined, 7);

    const result = await service.preview(DOC_ID, 'cambio X');

    expect(result.baseVersion).toBe(7);
  });

  it('un documento inexistente da 404 y no llama al modelo', async () => {
    const { service, prisma, invoke } = buildService();
    prisma.knowledgeDocument.findUnique.mockResolvedValue(null);

    await expect(service.preview(DOC_ID, 'cambio X')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('preview — ante la duda no inventa (FR-033)', () => {
  it('con confident:false devuelve el contenido ORIGINAL, no uno alterado', async () => {
    // Si igual devolviera un texto modificado, el frontend podría mostrarlo y
    // un supervisor apurado aprobaría un cambio que el modelo no supo hacer.
    const { service } = buildService({
      proposedContent: 'algo raro a medio hacer',
      summary: 'No queda claro a qué producto se refiere.',
      changedSections: [],
      confident: false,
    });

    const result = await service.preview(DOC_ID, 'subile un poco el anticipo');

    expect(result.confident).toBe(false);
    expect(result.proposedContent).toBe(ORIGINAL);
    expect(result.changedSections).toEqual([]);
  });

  it('si el modelo dice confident pero no cambió nada, igual se marca false', async () => {
    // Red de contención sobre la palabra del modelo: aprobar un no-cambio
    // versionaría el documento y pagaría una reindexación para nada.
    const { service } = buildService({
      proposedContent: ORIGINAL,
      summary: 'Listo',
      changedSections: [],
      confident: true,
    });

    const result = await service.preview(DOC_ID, 'cambio inaplicable');

    expect(result.confident).toBe(false);
  });

  it('si el modelo devuelve vacío, tampoco se propone', async () => {
    const { service } = buildService({
      proposedContent: '   ',
      summary: '',
      changedSections: [],
      confident: true,
    });

    const result = await service.preview(DOC_ID, 'cambio X');

    expect(result.confident).toBe(false);
    expect(result.proposedContent).toBe(ORIGINAL);
  });

  it('un fallo de Gemini no rompe el endpoint: informa que no pudo', async () => {
    const { service } = buildService(new Error('503 Service Unavailable'));

    const result = await service.preview(DOC_ID, 'cambio X');

    expect(result.confident).toBe(false);
    expect(result.proposedContent).toBe(ORIGINAL);
    expect(result.summary).toMatch(/mano|de nuevo/i);
  });
});

describe('apply — guarda lo aprobado, con su rastro (FR-049)', () => {
  it('persiste el texto del body, NO uno regenerado por el modelo', async () => {
    // El supervisor puede haber corregido la propuesta a mano antes de
    // aprobar; regenerar acá metería contenido que nadie leyó.
    const { service, knowledgeUpdate, invoke } = buildService();
    const editadoAMano = 'El anticipo mínimo es del 30% (revisado por Diego).';

    await service.apply(
      DOC_ID,
      { baseVersion: 3, content: editadoAMano, instruction: 'subir a 30%' },
      AUTOR,
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(knowledgeUpdate).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({ content: editadoAMano }),
      AUTOR,
    );
  });

  it('marca el cambio como AI_ACCEPTED y guarda la instrucción', async () => {
    // Es lo que después permite responder cuánto del corpus lo escribió una
    // persona y cuánto lo propuso el modelo.
    const { service, knowledgeUpdate } = buildService();

    await service.apply(
      DOC_ID,
      { baseVersion: 3, content: PROPUESTO, instruction: 'subir a 30%' },
      AUTOR,
    );

    expect(knowledgeUpdate).toHaveBeenCalledWith(
      DOC_ID,
      expect.objectContaining({
        origin: 'AI_ACCEPTED',
        aiInstruction: 'subir a 30%',
        expectedVersion: 3,
      }),
      AUTOR,
    );
  });

  it('propaga el 409 cuando la versión quedó vieja', async () => {
    const { service, knowledgeUpdate } = buildService();
    knowledgeUpdate.mockRejectedValue(new ConflictException('desactualizada'));

    await expect(
      service.apply(
        DOC_ID,
        { baseVersion: 3, content: PROPUESTO, instruction: 'x' },
        AUTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
