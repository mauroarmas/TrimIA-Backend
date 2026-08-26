import { ConflictException } from '@nestjs/common';
import { InterviewsCandidatesService } from './interviews-candidates.service';

/**
 * Tests de `InterviewsCandidatesService` (spec 010, US2) con un Prisma "en
 * memoria" para `InterviewCandidate`/`InterviewSession`/`InterviewQuestion`/
 * `InterviewAnswer`, y mocks simples para `KnowledgeDocument`/`Escalation`
 * — mismo criterio híbrido que el resto de la spec.
 */

function buildFakePrisma() {
  const sessions: any[] = [];
  const questions: any[] = [];
  const answers: any[] = [];
  const candidates: any[] = [];
  const documents: any[] = [];
  const escalations: any[] = [];
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const prisma = {
    interviewSession: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(sessions.find((s) => s.id === where.id) ?? null),
      ),
      findUniqueOrThrow: jest.fn(({ where }: any) => {
        const s = sessions.find((s) => s.id === where.id);
        if (!s) throw new Error('not found');
        return Promise.resolve(s);
      }),
      update: jest.fn(({ where, data }: any) => {
        const s = sessions.find((s) => s.id === where.id);
        Object.assign(s, data);
        return Promise.resolve(s);
      }),
    },
    interviewQuestion: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          questions.filter(
            (q) => q.sessionId === where.sessionId && q.status === where.status,
          ),
        ),
      ),
    },
    interviewAnswer: {
      findFirst: jest.fn(({ where }: any) => {
        const rows = answers
          .filter((a) => a.questionId === where.questionId)
          .sort((a, b) => b.attempt - a.attempt);
        return Promise.resolve(rows[0] ?? null);
      }),
    },
    interviewCandidate: {
      findMany: jest.fn(({ where, include }: any) => {
        const rows = candidates.filter((c) => c.sessionId === where.sessionId);
        if (include?.question) {
          return Promise.resolve(
            rows.map((c) => ({
              ...c,
              question: questions.find((q) => q.id === c.questionId),
            })),
          );
        }
        return Promise.resolve(rows);
      }),
      findUnique: jest.fn(({ where, include }: any) => {
        const c = candidates.find((c) => c.id === where.id);
        if (!c) return Promise.resolve(null);
        if (include?.question) {
          return Promise.resolve({
            ...c,
            question: questions.find((q) => q.id === c.questionId),
          });
        }
        return Promise.resolve(c);
      }),
      create: jest.fn(({ data }: any) => {
        const c = { id: nextId('cand'), status: 'PENDIENTE', ...data };
        candidates.push(c);
        return Promise.resolve(c);
      }),
      update: jest.fn(({ where, data }: any) => {
        const c = candidates.find((c) => c.id === where.id);
        Object.assign(c, data);
        return Promise.resolve(c);
      }),
      count: jest.fn(({ where }: any) =>
        Promise.resolve(
          candidates.filter(
            (c) => c.sessionId === where.sessionId && c.status === where.status,
          ).length,
        ),
      ),
    },
    knowledgeDocument: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(documents.find((d) => d.id === where.id) ?? null),
      ),
    },
    escalation: {
      update: jest.fn(({ where, data }: any) => {
        const e = escalations.find((e) => e.id === where.id);
        if (e) Object.assign(e, data);
        return Promise.resolve(e);
      }),
    },
  };

  return {
    prisma,
    sessions,
    questions,
    answers,
    candidates,
    documents,
    escalations,
  };
}

function draftingStub(overrides: Partial<{ redactarFicha: jest.Mock }> = {}) {
  return {
    redactarFicha: jest.fn().mockResolvedValue({
      title: 'Título redactado',
      content: 'Contenido redactado',
    }),
    ...overrides,
  };
}

function knowledgeStub(overrides: Record<string, jest.Mock> = {}) {
  return {
    esResponsableDeAgente: jest.fn().mockResolvedValue(true),
    buscarParecidos: jest.fn().mockResolvedValue([]),
    ingest: jest.fn().mockResolvedValue({ documentId: 'doc-nuevo' }),
    update: jest.fn().mockResolvedValue({ id: 'doc-1', version: 2 }),
    ...overrides,
  };
}

describe('InterviewsCandidatesService — runClose (T040/FR-024)', () => {
  it('crea un candidato por pregunta RESPONDIDA, y ninguno por las demás', async () => {
    const { prisma, sessions, questions, answers, candidates } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'CERRANDO' });
    questions.push(
      {
        id: 'q1',
        sessionId: 'sess-1',
        status: 'RESPONDIDA',
        kind: 'PEDIR_NUEVO',
        text: 't1',
        order: 1,
        documentId: null,
        documentVersion: null,
        themeLabel: 'Tema',
      },
      {
        id: 'q2',
        sessionId: 'sess-1',
        status: 'SALTEADA',
        kind: 'PEDIR_NUEVO',
        text: 't2',
        order: 2,
        documentId: null,
        documentVersion: null,
        themeLabel: 'Tema',
      },
    );
    answers.push({ questionId: 'q1', attempt: 1, text: 'respuesta útil' });

    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub() as any,
    );
    await service.runClose('sess-1');

    expect(candidates.filter((c) => c.sessionId === 'sess-1')).toHaveLength(1);
    expect(sessions.find((s) => s.id === 'sess-1').status).toBe('EN_REVISION');
  });

  it('una ficha que corrige un documento queda con targetDocumentId', async () => {
    const { prisma, sessions, questions, answers, candidates } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'CERRANDO' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      status: 'RESPONDIDA',
      kind: 'CORREGIR',
      text: 't1',
      order: 1,
      documentId: 'doc-1',
      documentVersion: 3,
      themeLabel: 'Tema',
    });
    answers.push({ questionId: 'q1', attempt: 1, text: 'le falta esto' });

    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub() as any,
    );
    await service.runClose('sess-1');

    const [candidato] = candidates;
    expect(candidato.targetDocumentId).toBe('doc-1');
    expect(candidato.targetVersion).toBe(3);
  });

  it('T024-equivalente al cerrar: si la redacción falla, el candidato queda FALLIDO con la respuesta cruda preservada', async () => {
    const { prisma, sessions, questions, answers, candidates } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'CERRANDO' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      status: 'RESPONDIDA',
      kind: 'PEDIR_NUEVO',
      text: 't1',
      order: 1,
      documentId: null,
      documentVersion: null,
      themeLabel: null,
    });
    answers.push({
      questionId: 'q1',
      attempt: 1,
      text: 'respuesta que no se pudo redactar',
    });

    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub({ redactarFicha: jest.fn().mockResolvedValue(null) }) as any,
    );
    await service.runClose('sess-1');

    expect(candidates[0].status).toBe('FALLIDO');
    expect(candidates[0].failureReason).toBeTruthy();
  });
});

describe('InterviewsCandidatesService — approve (FR-027/FR-028/FR-029/FR-030/FR-031/FR-032)', () => {
  function sesionConDosCandidatos() {
    const built = buildFakePrisma();
    const { sessions, questions, candidates } = built;
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push(
      {
        id: 'q1',
        sessionId: 'sess-1',
        origin: 'TEMA_COBERTURA',
        escalationId: null,
      },
      {
        id: 'q2',
        sessionId: 'sess-1',
        origin: 'TEMA_COBERTURA',
        escalationId: null,
      },
    );
    candidates.push(
      {
        id: 'cand-1',
        sessionId: 'sess-1',
        questionId: 'q1',
        status: 'PENDIENTE',
        title: 'Título 1',
        category: 'General',
        proposedContent: 'Contenido 1',
        editedContent: null,
        audience: 'INTERNO',
        targetDocumentId: null,
        targetVersion: null,
      },
      {
        id: 'cand-2',
        sessionId: 'sess-1',
        questionId: 'q2',
        status: 'PENDIENTE',
        title: 'Título 2',
        category: 'General',
        proposedContent: 'Contenido 2',
        editedContent: null,
        audience: 'INTERNO',
        targetDocumentId: null,
        targetVersion: null,
      },
    );
    return built;
  }

  it('T027/FR-027: un fallo (área ajena) no cancela los demás del lote', async () => {
    const { prisma, candidates } = sesionConDosCandidatos();
    const knowledge = knowledgeStub({
      esResponsableDeAgente: jest
        .fn()
        .mockResolvedValueOnce(false) // cand-1: rechazado
        .mockResolvedValueOnce(true), // cand-2: aprobado
    });
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    const { results } = await service.approve(['cand-1', 'cand-2'], 'emp-1');

    expect(results[0]).toMatchObject({
      candidateId: 'cand-1',
      ok: false,
      code: 'AREA_AJENA',
    });
    expect(results[1]).toMatchObject({
      candidateId: 'cand-2',
      ok: true,
      action: 'CREATED',
    });
    expect(candidates.find((c) => c.id === 'cand-2').status).toBe('APROBADO');
    expect(candidates.find((c) => c.id === 'cand-1').status).toBe('PENDIENTE');
  });

  it('FR-028: lo que se ingesta es editedContent cuando existe, no proposedContent', async () => {
    const { prisma, candidates } = sesionConDosCandidatos();
    candidates[0].editedContent = 'Contenido editado por la persona';
    const knowledge = knowledgeStub();
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    await service.approve(['cand-1'], 'emp-1');

    expect(knowledge.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Contenido editado por la persona' }),
    );
  });

  it('FR-030: conflicto de versión al corregir da VERSION_CAMBIO con la versión actual', async () => {
    const { prisma, sessions, questions, candidates, documents } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'C',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: 'doc-1',
      targetVersion: 3,
    });
    documents.push({ id: 'doc-1', isActive: true, version: 5 });

    const knowledge = knowledgeStub({
      update: jest.fn().mockRejectedValue(
        new ConflictException({
          reason: 'VERSION_CONFLICT',
          currentVersion: 5,
        }),
      ),
    });
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    const { results } = await service.approve(['cand-1'], 'emp-1');

    expect(results[0]).toMatchObject({
      candidateId: 'cand-1',
      ok: false,
      code: 'VERSION_CAMBIO',
      currentVersion: 5,
    });
  });

  // ⚠️ El defecto que reportó el uso real (2026-08-25). La pregunta que
  // origina una corrección es "¿qué le FALTA a este documento?", y quien
  // redacta la ficha —el modelo— **no ve el documento original**: solo la
  // respuesta. Escribir esa ficha como contenido entero borra todo lo que el
  // documento decía.
  //
  // Pasó de verdad: «Sobre Nosotros» quedó hablando solo de facturas después
  // de una entrevista sobre facturación. Ningún test lo veía porque todos
  // miraban el resultado (`ok: true`), no QUÉ se escribió.
  it('AGREGAR (default): la corrección se suma al contenido, no lo pisa', async () => {
    const { prisma, sessions, questions, candidates, documents } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'Las facturas se envían por mail al procesarse el pago.',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: 'doc-1',
      targetVersion: 3,
      applyMode: 'AGREGAR',
    });
    documents.push({
      id: 'doc-1',
      isActive: true,
      version: 3,
      content: 'Credimisión es una empresa comercial de Misiones.',
    });

    const knowledge = knowledgeStub();
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    const { results } = await service.approve(['cand-1'], 'emp-1');
    expect(results[0]).toMatchObject({ ok: true });

    const escrito = knowledge.update.mock.calls[0][1].content;
    // Lo viejo SIGUE ahí…
    expect(escrito).toContain('Credimisión es una empresa comercial');
    // …y lo nuevo se sumó.
    expect(escrito).toContain('Las facturas se envían por mail');
  });

  it('REEMPLAZAR: pisa el contenido, pero solo si alguien lo eligió', async () => {
    const { prisma, sessions, questions, candidates, documents } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'El texto nuevo y definitivo.',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: 'doc-1',
      targetVersion: 3,
      applyMode: 'REEMPLAZAR',
    });
    documents.push({
      id: 'doc-1',
      isActive: true,
      version: 3,
      content: 'Lo que decía antes.',
    });

    const knowledge = knowledgeStub();
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    await service.approve(['cand-1'], 'emp-1');

    const escrito = knowledge.update.mock.calls[0][1].content;
    expect(escrito).toBe('El texto nuevo y definitivo.');
    expect(escrito).not.toContain('Lo que decía antes');
  });

  it('FR-031: documento desactivado da DOCUMENTO_AUSENTE', async () => {
    const { prisma, sessions, questions, candidates, documents } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'C',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: 'doc-1',
      targetVersion: 3,
    });
    documents.push({ id: 'doc-1', isActive: false, version: 3 });

    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub() as any,
    );

    const { results } = await service.approve(['cand-1'], 'emp-1');
    expect(results[0]).toMatchObject({ ok: false, code: 'DOCUMENTO_AUSENTE' });
  });

  it('T050: la sesión pasa a CERRADA cuando no queda ningún candidato PENDIENTE', async () => {
    const { prisma, sessions, candidates } = sesionConDosCandidatos();
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub() as any,
    );

    await service.approve(['cand-1'], 'emp-1');
    expect(sessions.find((s) => s.id === 'sess-1').status).toBe('EN_REVISION');

    await service.discard('cand-2', 'emp-1');
    expect(sessions.find((s) => s.id === 'sess-1').status).toBe('CERRADA');
    // Descartar no borra (T049).
    expect(candidates.find((c) => c.id === 'cand-2').status).toBe('DESCARTADO');
  });

  it('FR-035a/b: al aprobar un candidato de escalado pendiente, cierra el caso sin enviarle nada al usuario', async () => {
    const { prisma, sessions, questions, candidates, escalations } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'ESCALADO_PENDIENTE',
      escalationId: 'esc-1',
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'La respuesta es X',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: null,
      targetVersion: null,
    });
    escalations.push({ id: 'esc-1', status: 'PENDING' });

    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub() as any,
    );
    await service.approve(['cand-1'], 'emp-1');

    const escalado = escalations.find((e) => e.id === 'esc-1');
    expect(escalado.status).toBe('RESOLVED');
    expect(escalado.resolution).toBe('La respuesta es X');
    // No hay ningún WhatsappSenderService inyectado: si el código intentara
    // enviar algo, esto ni compilaría — la garantía es estructural.
  });
});

describe('InterviewsCandidatesService — FR-034 (T070, bug real encontrado en vivo)', () => {
  it('sourceId apunta a la SESIÓN, no al candidato — varias fichas pueden salir de la misma entrevista', async () => {
    const { prisma } = sesionConDosCandidatosHelper();
    const knowledge = knowledgeStub();
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    await service.approve(['cand-1'], 'emp-1');

    expect(knowledge.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'ENTREVISTA', sourceId: 'sess-1' }),
    );
  });

  function sesionConDosCandidatosHelper() {
    const built = buildFakePrisma();
    const { sessions, questions, candidates } = built;
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'C',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: null,
      targetVersion: null,
    });
    return built;
  }
});

describe('InterviewsCandidatesService — SC-010/FR-013b (T061)', () => {
  it('el texto de una resolución nunca entra al corpus tal como se envió — lo que se ingesta es la ficha redactada, sin el nombre ni el pedido puntual', async () => {
    const { prisma, sessions, questions, answers, candidates } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'CERRANDO' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      status: 'RESPONDIDA',
      kind: 'GENERALIZAR',
      text: '¿Confirmás esta resolución de forma general?',
      order: 1,
      documentId: null,
      documentVersion: null,
      themeLabel: null,
      resolutionText: 'Hola Juan, tu pedido #123 sale el martes.',
      origin: 'ESCALADO_SIN_CAPITALIZAR',
      escalationId: 'esc-1',
    });
    // La respuesta cruda de la entrevista TAMBIÉN podría repetir el caso puntual
    // (la persona confirmando lo que ya se le dijo al cliente) — es justo el
    // caso que no puede colarse al corpus.
    answers.push({
      questionId: 'q1',
      attempt: 1,
      text: 'Sí, confirmo: a Juan le dijimos que su pedido #123 sale el martes.',
    });

    // El modelo, correctamente instruido por FICHA_PROMPT_GENERALIZAR (T060,
    // verificado en interviews-drafting.service.spec.ts), redacta SIN el
    // nombre ni el pedido puntual.
    const drafting = {
      redactarFicha: jest.fn().mockResolvedValue({
        title: 'Plazos de entrega de pedidos',
        content: 'Los pedidos confirmados salen los días martes.',
      }),
    };

    const closeService = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      drafting as any,
    );
    await closeService.runClose('sess-1');

    const candidato = candidates[0];
    expect(candidato.proposedContent).not.toMatch(/Juan/);
    expect(candidato.proposedContent).not.toMatch(/#123/);

    // Y lo que efectivamente se ingesta al aprobar es ESE contenido, no
    // question.resolutionText ni la respuesta cruda de la entrevista.
    const knowledge = knowledgeStub();
    const approveService = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      drafting as any,
    );
    await approveService.approve([candidato.id], 'emp-1');

    expect(knowledge.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Los pedidos confirmados salen los días martes.',
      }),
    );
    const contenidoIngestado = knowledge.ingest.mock.calls[0][0].content;
    expect(contenidoIngestado).not.toMatch(/Juan/);
    expect(contenidoIngestado).not.toMatch(/#123/);
  });
});

describe('InterviewsCandidatesService — SC-002: nada entra al corpus sin approve', () => {
  it('discard() no llama a ingest ni a update', async () => {
    const { prisma, sessions, questions, candidates } = buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'C',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: null,
      targetVersion: null,
    });

    const knowledge = knowledgeStub();
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    await service.discard('cand-1', 'emp-1');

    expect(knowledge.ingest).not.toHaveBeenCalled();
    expect(knowledge.update).not.toHaveBeenCalled();
  });
});

describe('InterviewsCandidatesService — SC-007', () => {
  it('perder el área entre abrir y aprobar da AREA_AJENA, y no bloquea otros candidatos de OTRA área', async () => {
    const { prisma, sessions, questions, candidates } = buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      origin: 'TEMA_COBERTURA',
      escalationId: null,
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'C',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: null,
      targetVersion: null,
    });

    const knowledge = knowledgeStub({
      esResponsableDeAgente: jest.fn().mockResolvedValue(false),
    });
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    const { results } = await service.approve(['cand-1'], 'emp-1');
    expect(results[0]).toMatchObject({ ok: false, code: 'AREA_AJENA' });
    expect(candidates[0].status).toBe('PENDIENTE');
  });
});

describe('InterviewsCandidatesService — SC-009', () => {
  it('al pedir la revisión de una sesión, un candidato nuevo trae en `similar` los documentos parecidos ya existentes', async () => {
    const { prisma, sessions, questions, candidates } = buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'EN_REVISION' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      order: 1,
      text: 'pregunta',
      origin: 'TEMA_COBERTURA',
    });
    candidates.push({
      id: 'cand-1',
      sessionId: 'sess-1',
      questionId: 'q1',
      status: 'PENDIENTE',
      title: 'T',
      category: 'General',
      proposedContent: 'Contenido parecido a otro ya cargado',
      editedContent: null,
      audience: 'INTERNO',
      targetDocumentId: null,
      targetVersion: null,
    });

    const knowledge = knowledgeStub({
      buscarParecidos: jest.fn().mockResolvedValue([
        {
          documentId: 'doc-de-otra-sesion',
          title: 'Ya cargado antes',
          score: 78,
          audienciaDistinta: false,
        },
      ]),
    });
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledge as any,
      draftingStub() as any,
    );

    const { candidates: vista } = await service.list('sess-1', 'emp-1');

    expect(vista[0].similar).toEqual([
      {
        documentId: 'doc-de-otra-sesion',
        title: 'Ya cargado antes',
        score: 78,
        audienciaDistinta: false,
      },
    ]);
    // FR-029/D6: se calculó ANTES de que este candidato se apruebe — sigue PENDIENTE.
    expect(candidates[0].status).toBe('PENDIENTE');
  });
});

describe('InterviewsCandidatesService — el cierre no se entera de la spec 012', () => {
  it('la ficha se redacta del texto guardado, venga de una opción o del teclado', async () => {
    // US3/T025: `InterviewAnswer` no distingue el origen, así que el cierre
    // funciona igual. Si algún día hiciera falta saber de dónde salió una
    // respuesta, este test es el que se rompe primero — y es la señal de que
    // el diseño de data-model.md cambió.
    const { prisma, sessions, questions, answers, candidates } =
      buildFakePrisma();
    sessions.push({ id: 'sess-1', agentType: 'SALES', status: 'CERRANDO' });
    questions.push({
      id: 'q1',
      sessionId: 'sess-1',
      status: 'RESPONDIDA',
      kind: 'PEDIR_NUEVO',
      text: '¿Cobran envío a domicilio?',
      order: 1,
      documentId: null,
      documentVersion: null,
      themeLabel: 'Tema',
      // La pregunta tenía opciones y la persona eligió una tal cual.
      options: ['Sí, con recargo del 10%.'],
    });
    answers.push({
      questionId: 'q1',
      attempt: 1,
      text: 'Sí, con recargo del 10%.',
    });

    const redactarFicha = jest.fn().mockResolvedValue({
      title: 'Envío a domicilio',
      content: 'El envío a domicilio tiene un recargo del 10%.',
    });
    const service = new InterviewsCandidatesService(
      prisma as any,
      knowledgeStub() as any,
      draftingStub({ redactarFicha }) as any,
    );

    await service.runClose('sess-1');

    // Lo que llega al redactor es el texto, sin ninguna marca de origen.
    expect(redactarFicha).toHaveBeenCalledWith(
      expect.objectContaining({ respuestaCruda: 'Sí, con recargo del 10%.' }),
    );
    expect(candidates.filter((c) => c.sessionId === 'sess-1')).toHaveLength(1);
    expect(sessions.find((s) => s.id === 'sess-1').status).toBe('EN_REVISION');
  });
});
