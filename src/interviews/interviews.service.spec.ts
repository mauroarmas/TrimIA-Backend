import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InterviewsService } from './interviews.service';

/**
 * Tests de `InterviewsService` con un Prisma "en memoria" para las tablas de
 * esta spec (`InterviewSession`, `InterviewQuestion`, `InterviewAnswer`,
 * `InterviewCandidate`) — mismo criterio que `knowledge-coverage.service.spec.ts`:
 * hace falta comportamiento real (orden, transiciones) y no solo "se llamó
 * con tal argumento". Las tablas de otras specs (`Sector`, `Escalation`,
 * `Message`, `KnowledgeDocument`) van con mocks simples.
 */

function buildConfig(overrides: Record<string, number> = {}) {
  const values: Record<string, number> = {
    COVERAGE_THEME_OVERLAP: 0.5,
    INTERVIEW_MAX_QUESTIONS: 7,
    INTERVIEW_MAX_QUOTES_PER_QUESTION: 2,
    INTERVIEW_ABANDON_DAYS: 7,
    INTERVIEW_MAX_ESCALATIONS_FALLBACK: 10,
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function buildQueue() {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

function buildFakePrisma() {
  const sessions: any[] = [];
  const questions: any[] = [];
  const answers: any[] = [];
  const candidates: any[] = [];
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const prisma = {
    sector: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'sector-ventas',
        name: 'Ventas',
        agentType: 'SALES',
      }),
    },
    interviewSession: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          sessions.find(
            (s) =>
              s.openedById === where.openedById &&
              s.sectorId === where.sectorId &&
              where.status.in.includes(s.status),
          ) ?? null,
        ),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(sessions.find((s) => s.id === where.id) ?? null),
      ),
      findUniqueOrThrow: jest.fn(({ where }: any) => {
        const s = sessions.find((s) => s.id === where.id);
        if (!s) throw new Error('not found');
        return Promise.resolve(s);
      }),
      // `findMany` y `delete` los usa la reconciliación de sesiones
      // duplicadas: sin ellos el fake no puede representar la carrera que
      // FR-003 tiene que resolver.
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          sessions.filter(
            (s) =>
              s.openedById === where.openedById &&
              s.sectorId === where.sectorId &&
              where.status.in.includes(s.status),
          ),
        ),
      ),
      delete: jest.fn(({ where }: any) => {
        const i = sessions.findIndex((s) => s.id === where.id);
        if (i === -1) throw new Error('not found');
        return Promise.resolve(sessions.splice(i, 1)[0]);
      }),
      create: jest.fn(({ data }: any) => {
        const session = {
          id: nextId('session'),
          lastActivityAt: new Date(),
          // Prisma lo pone con @default(now()); el desempate de la
          // reconciliación lo necesita.
          createdAt: new Date(),
          ...data,
        };
        sessions.push(session);
        return Promise.resolve(session);
      }),
      update: jest.fn(({ where, data }: any) => {
        const session = sessions.find((s) => s.id === where.id);
        Object.assign(session, data);
        return Promise.resolve(session);
      }),
    },
    interviewQuestion: {
      findMany: jest.fn(({ where }: any) => {
        // Usado para "yaPreguntado": preguntas previas de sesiones no FALLIDA del área.
        if (where.session) {
          const idsSesionesDelArea = sessions
            .filter(
              (s) =>
                s.sectorId === where.session.sectorId &&
                s.status !== where.session.status.not,
            )
            .map((s) => s.id);
          return Promise.resolve(
            questions.filter((q) => idsSesionesDelArea.includes(q.sessionId)),
          );
        }
        return Promise.resolve(
          questions.filter((q) => q.sessionId === where.sessionId),
        );
      }),
      findFirst: jest.fn(({ where }: any) => {
        let rows = questions.filter((q) => q.sessionId === where.sessionId);
        if (where.status) rows = rows.filter((q) => q.status === where.status);
        rows = [...rows].sort((a, b) => a.order - b.order);
        return Promise.resolve(rows[0] ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        // El schema real defaultea status a PENDIENTE — el fake tiene que
        // igualarlo, si no `preguntaActual` nunca encuentra nada.
        const question = {
          id: nextId('question'),
          status: 'PENDIENTE',
          ...data,
        };
        questions.push(question);
        return Promise.resolve(question);
      }),
      update: jest.fn(({ where, data }: any) => {
        const question = questions.find((q) => q.id === where.id);
        Object.assign(question, data);
        return Promise.resolve(question);
      }),
      count: jest.fn(({ where }: any) => {
        let rows = questions.filter((q) => q.sessionId === where.sessionId);
        if (where.status) rows = rows.filter((q) => q.status === where.status);
        return Promise.resolve(rows.length);
      }),
    },
    interviewAnswer: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          answers.filter((a) => a.questionId === where.questionId),
        ),
      ),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          answers.find(
            (a) =>
              a.questionId === where.questionId &&
              (!where.flaggedThin || a.flaggedThin),
          ) ?? null,
        ),
      ),
      create: jest.fn(({ data }: any) => {
        const answer = { id: nextId('answer'), createdAt: new Date(), ...data };
        answers.push(answer);
        return Promise.resolve(answer);
      }),
    },
    interviewCandidate: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    escalation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    knowledgeDocument: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    message: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
  };

  return { prisma, sessions, questions, answers, candidates };
}

const knowledgeStub = {
  esResponsableDeAgente: jest.fn().mockResolvedValue(true),
};

/**
 * Spec 011: el material ya NO lo resuelve esta clase — lo arma
 * `ImprovementsService` uniendo las tres fuentes, y la entrevista lo consume.
 * Acá se stubea esa entrada; el armado de la lista (orden, deduplicación,
 * corte, filtrado por descarte y por lo ya entrevistado) se prueba en
 * `improvements-list.spec.ts` y `improvements.service.spec.ts`.
 */
function improvementsStubConTemas(n = 3) {
  return {
    materialParaEntrevista: jest.fn().mockResolvedValue({
      material: Array.from({ length: n }, (_, i) => ({
        origin: 'TEMA_COBERTURA',
        themeId: `theme-${i}`,
        label: `Tema ${i}`,
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: [`ev-${i}`],
        quotes: [`consulta ${i}`],
        queryCount: 3 - i,
        documents: [],
      })),
      huboItems: n > 0,
    }),
  };
}

/** Ni consultas sin responder, ni escalados, ni documentos incompletos. */
function improvementsStubSinNada() {
  return {
    materialParaEntrevista: jest
      .fn()
      .mockResolvedValue({ material: [], huboItems: false }),
  };
}

/** Había ítems, pero todos se preguntaron ya: NO es lo mismo que no haber nada. */
function improvementsStubTodoPreguntado() {
  return {
    materialParaEntrevista: jest
      .fn()
      .mockResolvedValue({ material: [], huboItems: true }),
  };
}

const coverageStub = { getLatest: jest.fn(), hayScanCorriendo: jest.fn() };

function draftingStubOk() {
  return {
    redactarPreguntas: jest.fn((items: { id: string }[]) =>
      Promise.resolve(
        new Map(items.map((it) => [it.id, `Pregunta redactada para ${it.id}`])),
      ),
    ),
  };
}

function draftingStubFalla() {
  return { redactarPreguntas: jest.fn().mockResolvedValue(null) };
}

function buildService(overrides: {
  prisma: any;
  config?: any;
  coverage?: any;
  improvements?: any;
  drafting?: any;
  knowledge?: any;
  openQueue?: any;
  closeQueue?: any;
}) {
  const openQueue = overrides.openQueue ?? buildQueue();
  const closeQueue = overrides.closeQueue ?? buildQueue();
  const service = new InterviewsService(
    overrides.prisma,
    (overrides.config ?? buildConfig()) as any,
    openQueue as any,
    closeQueue as any,
    (overrides.knowledge ?? knowledgeStub) as any,
    (overrides.coverage ?? coverageStub) as any,
    (overrides.drafting ?? draftingStubOk()) as any,
    (overrides.improvements ?? improvementsStubConTemas()) as any,
  );
  return { service, openQueue, closeQueue };
}

describe('InterviewsService — open', () => {
  it('abre la sesión en PREPARANDO cuando hay temas de cobertura', async () => {
    const { prisma } = buildFakePrisma();
    const { service } = buildService({ prisma });

    const res = await service.open('sector-ventas', 'emp-1');

    expect(res.status).toBe('PREPARANDO');
    expect(res.agentType).toBe('SALES');
  });

  it('FR-002: rechaza si no es responsable del área', async () => {
    const { prisma } = buildFakePrisma();
    const knowledge = {
      esResponsableDeAgente: jest.fn().mockResolvedValue(false),
    };
    const { service } = buildService({ prisma, knowledge });

    await expect(service.open('sector-ventas', 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('FR-003: una sesión sin cerrar por área devuelve un 409 con esa sesión', async () => {
    const { prisma } = buildFakePrisma();
    const { service } = buildService({ prisma });

    await service.open('sector-ventas', 'emp-1');
    await expect(service.open('sector-ventas', 'emp-1')).rejects.toThrow(
      ConflictException,
    );
  });

  // Los dos motivos que sobreviven a la spec 011 NO son intercambiables:
  // decirle "no hay nada que mejorar" a quien viene de apretar un ítem que
  // está viendo en pantalla es mentirle. El bug se encontró clickeando el
  // salto entre pantallas, que por API no se veía.
  //
  // Spec 011: QUÉ ya se preguntó lo decide `ImprovementsService` (y se prueba
  // en `improvements-list.spec.ts`). Lo que le queda a esta clase, y es lo que
  // se prueba acá, es distinguir "había y ya se preguntó todo" de "no había".
  it('YA_ENTREVISTADO: había ítems pero ya se preguntaron todos — no "TODO_CUBIERTO", que sería mentir', async () => {
    const { prisma } = buildFakePrisma();
    const { service } = buildService({
      prisma,
      improvements: improvementsStubTodoPreguntado(),
    });

    await expect(service.open('sector-ventas', 'emp-1')).rejects.toMatchObject({
      response: { reason: 'YA_ENTREVISTADO' },
    });
  });

  it('TODO_CUBIERTO: no había ningún ítem de ninguna de las tres fuentes', async () => {
    const { prisma } = buildFakePrisma();
    const { service } = buildService({
      prisma,
      improvements: improvementsStubSinNada(),
    });

    await expect(service.open('sector-ventas', 'emp-1')).rejects.toMatchObject({
      response: { reason: 'TODO_CUBIERTO' },
    });
  });

  // ⚠️ La carrera que FR-003 debía impedir y no impedía. Entre el `findFirst`
  // y el `create` hay una ventana: dos aperturas casi simultáneas la pasan las
  // dos. Pasó de verdad al automatizar el panel — dos sesiones de Ventas con
  // **6 milisegundos** de diferencia, con las mismas cuatro preguntas.
  //
  // Prisma no modela índices únicos parciales, así que se reconcilia después
  // de crear: gana la más vieja, con desempate por id. Determinista, para que
  // las dos llamadas lleguen a la misma conclusión sin hablarse.
  it('FR-003: dos aperturas simultáneas dejan UNA sola sesión', async () => {
    const { prisma, sessions } = buildFakePrisma();
    const { service } = buildService({ prisma });

    // Las dos pasan el findFirst antes de que ninguna cree: se simula
    // arrancándolas juntas.
    const [a, b] = await Promise.allSettled([
      service.open('sector-ventas', 'emp-1'),
      service.open('sector-ventas', 'emp-1'),
    ]);

    const abiertas = sessions.filter((s: { status: string }) =>
      ['PREPARANDO', 'EN_CURSO', 'CERRANDO', 'EN_REVISION'].includes(s.status),
    );
    expect(abiertas).toHaveLength(1);

    // Una ganó y la otra recibió un 409 apuntando a la que ganó — no un
    // error genérico: para quien llama es "seguí con la que ya tenías".
    const oks = [a, b].filter((r) => r.status === 'fulfilled');
    const fallos = [a, b].filter((r) => r.status === 'rejected');
    expect(oks).toHaveLength(1);
    expect(fallos).toHaveLength(1);
    expect((fallos[0] as PromiseRejectedResult).reason).toMatchObject({
      response: { reason: 'SESSION_ALREADY_OPEN' },
    });
  });

  // Spec 011 (FR-005): entrevistarse sobre el ítem elegido en la lista. El
  // itemId viaja hasta quien arma el material — si se perdiera en el camino,
  // alguien aprieta un ítem y le preguntan por otro.
  it('FR-005: el itemId elegido llega a quien arma el material', async () => {
    const { prisma } = buildFakePrisma();
    const improvements = improvementsStubConTemas(2);
    const { service } = buildService({ prisma, improvements });

    await service.open('sector-ventas', 'emp-1', 'doc:D1');

    expect(improvements.materialParaEntrevista).toHaveBeenCalledWith(
      'sector-ventas',
      'SALES',
      'emp-1',
      'doc:D1',
    );
  });

  it('FR-016: sin temas ni respaldo, da 422 con el motivo', async () => {
    const { prisma } = buildFakePrisma();
    const { service } = buildService({
      prisma,
      improvements: improvementsStubSinNada(),
    });

    await expect(service.open('sector-ventas', 'emp-1')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('InterviewsService — runOpen', () => {
  it('persiste una pregunta por ítem de material y pasa a EN_CURSO', async () => {
    const { prisma, sessions, questions } = buildFakePrisma();
    const { service } = buildService({ prisma });

    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['consulta 1'],
        queryCount: 3,
        documents: [],
      },
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't2',
        label: 'Tema 2',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-2'],
        quotes: ['consulta 2'],
        queryCount: 1,
        documents: [],
      },
    ] as any);

    expect(sessions.find((s) => s.id === session.id).status).toBe('EN_CURSO');
    expect(questions.filter((q) => q.sessionId === session.id)).toHaveLength(2);
  });

  it('T024/FR-005: si la redacción falla, la sesión queda FALLIDA — sin preguntas a medias', async () => {
    const { prisma, sessions, questions } = buildFakePrisma();
    const { service } = buildService({ prisma, drafting: draftingStubFalla() });

    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);

    const refrescada = sessions.find((s) => s.id === session.id);
    expect(refrescada.status).toBe('FALLIDA');
    expect(refrescada.failureReason).toBeTruthy();
    expect(questions.filter((q) => q.sessionId === session.id)).toHaveLength(0);
  });
});

describe('InterviewsService — responder / saltear', () => {
  async function sesionConTresPreguntas() {
    const { prisma, sessions, questions } = buildFakePrisma();
    const { service } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(
      session.id,
      [0, 1, 2].map((i) => ({
        origin: 'TEMA_COBERTURA',
        themeId: `t${i}`,
        label: `Tema ${i}`,
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: [`ev-${i}`],
        quotes: [`consulta ${i}`],
        queryCount: 3 - i,
        documents: [],
      })) as any,
    );
    return { service, session, sessions, questions };
  }

  it('avanza a la siguiente pregunta al contestar', async () => {
    const { service, session, questions } = await sesionConTresPreguntas();
    const primera = questions.find(
      (q) => q.sessionId === session.id && q.order === 1,
    );

    const res = await service.answer(
      session.id,
      primera.id,
      'A Posadas llega en 48 horas.',
      'emp-1',
    );

    expect(res.retry).toBe(false);
    expect(res.progress).toEqual({ answered: 1, total: 3 });
    expect(res.next!.order).toBe(2);
  });

  it('FR-019: saltear no produce candidato y avanza igual', async () => {
    const { service, session, questions } = await sesionConTresPreguntas();
    const primera = questions.find(
      (q) => q.sessionId === session.id && q.order === 1,
    );

    const res = await service.skip(session.id, primera.id, 'emp-1');

    expect(res.progress).toEqual({ answered: 1, total: 3 });
    expect(primera.status).toBe('SALTEADA');
  });

  it('FR-018/FR-018a: una respuesta vacía repregunta una vez y no avanza', async () => {
    const { service, session, questions } = await sesionConTresPreguntas();
    const primera = questions.find(
      (q) => q.sessionId === session.id && q.order === 1,
    );

    const res = await service.answer(session.id, primera.id, 'ok', 'emp-1');

    expect(res.retry).toBe(true);
    expect(res.next!.id).toBe(primera.id);
    expect(res.progress).toEqual({ answered: 0, total: 3 });
    expect(primera.status).toBe('PENDIENTE');
  });

  it('la segunda respuesta vacía ya NO repregunta — pasa a SIN_RESPONDER y avanza', async () => {
    const { service, session, questions } = await sesionConTresPreguntas();
    const primera = questions.find(
      (q) => q.sessionId === session.id && q.order === 1,
    );

    await service.answer(session.id, primera.id, 'ok', 'emp-1');
    const res = await service.answer(session.id, primera.id, 'nada', 'emp-1');

    expect(res.retry).toBe(false);
    expect(primera.status).toBe('SIN_RESPONDER');
    expect(res.progress).toEqual({ answered: 1, total: 3 });
  });

  it('409 si se contesta una pregunta que no es la actual', async () => {
    const { service, session, questions } = await sesionConTresPreguntas();
    const segunda = questions.find(
      (q) => q.sessionId === session.id && q.order === 2,
    );

    await expect(
      service.answer(session.id, segunda.id, 'algo', 'emp-1'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('InterviewsService — confidencialidad (FR-012/FR-017c)', () => {
  it('el envelope de la pregunta actual no expone conversationId ni ningún campo de contacto', async () => {
    const { prisma } = buildFakePrisma();
    const { service } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['consulta con datos'],
        queryCount: 1,
        documents: [],
      },
    ] as any);

    const estado = await service.get(session.id, 'emp-1');

    expect(estado.current).not.toHaveProperty('conversationId');
    expect(JSON.stringify(estado.current)).not.toMatch(
      /conversationId|telefono|phone/i,
    );
  });

  it('FR-017c: abrir y responder una entrevista nunca toca `Conversation` ni `OrchestrationEvent` — no existen en el Prisma inyectado', async () => {
    const { prisma, questions } = buildFakePrisma();
    // A propósito: el fake NO define prisma.conversation ni
    // prisma.orchestrationEvent. Si el servicio los tocara, esto explota.
    const { service } = buildService({ prisma });

    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);
    const primera = questions.find((q) => q.sessionId === session.id);
    await service.answer(
      session.id,
      primera.id,
      'respuesta con contenido real',
      'emp-1',
    );

    expect((prisma as any).conversation).toBeUndefined();
    expect((prisma as any).orchestrationEvent).toBeUndefined();
  });
});

describe('InterviewsService — retomar y abandonar (US4)', () => {
  async function sesionConTresPreguntas() {
    const { prisma, sessions, questions } = buildFakePrisma();
    const { service, closeQueue } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(
      session.id,
      [0, 1, 2].map((i) => ({
        origin: 'TEMA_COBERTURA',
        themeId: `t${i}`,
        label: `Tema ${i}`,
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: [`ev-${i}`],
        quotes: [`consulta ${i}`],
        queryCount: 3 - i,
        documents: [],
      })) as any,
    );
    return { service, session, sessions, questions, closeQueue };
  }

  it('FR-021: retoma en la primera pregunta pendiente, con las respuestas anteriores intactas', async () => {
    const { service, session, questions } = await sesionConTresPreguntas();
    const primera = questions.find(
      (q) => q.sessionId === session.id && q.order === 1,
    );
    await service.answer(session.id, primera.id, 'primera respuesta', 'emp-1');

    // "Se aleja y vuelve": una nueva consulta de get() tiene que retomar en
    // la 2, no perder que la 1 ya se contestó.
    const estado = await service.get(session.id, 'emp-1');

    expect(estado.progress).toEqual({ answered: 1, total: 3 });
    expect(estado.current!.order).toBe(2);
  });

  it('FR-022/T065: sin actividad por más de INTERVIEW_ABANDON_DAYS, get() la marca ABANDONADA', async () => {
    const { prisma, sessions } = buildFakePrisma();
    const { service } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);

    // Simula inactividad: la mueve más atrás que el plazo configurado (7 días).
    const s = sessions.find((s) => s.id === session.id);
    s.lastActivityAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    const estado = await service.get(session.id, 'emp-1');

    expect(estado.status).toBe('ABANDONADA');
    expect(estado.current).toBeNull();
    expect(sessions.find((s) => s.id === session.id).status).toBe('ABANDONADA');
  });

  it('FR-021 vs FR-022: actividad reciente NO se marca abandonada aunque haya pasado tiempo', async () => {
    const { prisma, sessions } = buildFakePrisma();
    const { service } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);

    const s = sessions.find((s) => s.id === session.id);
    s.lastActivityAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 días, bajo el límite de 7

    const estado = await service.get(session.id, 'emp-1');
    expect(estado.status).toBe('EN_CURSO');
  });

  it('FR-022a/FR-023: el abandono NO se cierra solo — no encola el cierre por su cuenta', async () => {
    const { prisma, sessions } = buildFakePrisma();
    const { service, closeQueue } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);
    sessions.find((s) => s.id === session.id).lastActivityAt = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    );

    await service.get(session.id, 'emp-1');

    expect(closeQueue.add).not.toHaveBeenCalled();
  });

  it('FR-022a: una sesión ABANDONADA se puede cerrar igual que una en curso — es una capacidad, no algo automático', async () => {
    const { prisma, sessions } = buildFakePrisma();
    const { service, closeQueue } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);
    sessions.find((s) => s.id === session.id).lastActivityAt = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    );
    await service.get(session.id, 'emp-1'); // dispara la transición a ABANDONADA

    const res = await service.finish(session.id, true, 'emp-1');

    expect(res.status).toBe('CERRANDO');
    expect(closeQueue.add).toHaveBeenCalledWith('close', {
      sessionId: session.id,
    });
  });

  it('answer()/skip() siguen rechazando una sesión ABANDONADA', async () => {
    const { prisma, sessions, questions } = buildFakePrisma();
    const { service } = buildService({ prisma });
    const session = await service.open('sector-ventas', 'emp-1');
    await service.runOpen(session.id, [
      {
        origin: 'TEMA_COBERTURA',
        themeId: 't1',
        label: 'Tema 1',
        agentType: 'SALES',
        band: 'SIN_RESPUESTA',
        cause: 'NO_HAY_NADA',
        queryEventIds: ['ev-1'],
        quotes: ['c'],
        queryCount: 1,
        documents: [],
      },
    ] as any);
    sessions.find((s) => s.id === session.id).lastActivityAt = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    );
    await service.get(session.id, 'emp-1');

    const pregunta = questions.find((q) => q.sessionId === session.id);
    await expect(
      service.answer(session.id, pregunta.id, 'algo', 'emp-1'),
    ).rejects.toThrow(ConflictException);
  });
});
