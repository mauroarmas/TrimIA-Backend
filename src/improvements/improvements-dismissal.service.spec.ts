import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ImprovementsDismissalService } from './improvements-dismissal.service';

/**
 * El descarte para las tres fuentes. Lo que importa acá es QUÉ se guarda en
 * cada caso: de eso depende cuándo el ítem vuelve a aparecer (FR-026/FR-026a),
 * y equivocarse falla en silencio — nadie nota lo que no reaparece.
 */

function buildFakePrisma(over: any = {}) {
  return {
    improvementDismissal: { create: jest.fn().mockResolvedValue({}) },
    knowledgeDocument: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ version: 3, agentType: 'SALES' }),
    },
    escalation: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ conversation: { currentAgent: 'SALES' } }),
    },
    coverageTheme: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ queryEventIds: ['q1', 'q2'], agentType: 'SALES' }),
    },
    sector: { findFirst: jest.fn().mockResolvedValue({ id: 'sector-ventas' }) },
    ...over,
  };
}

function build(over: any = {}) {
  const prisma = over.prisma ?? buildFakePrisma();
  const knowledge = over.knowledge ?? {
    esResponsableDeAgente: jest.fn().mockResolvedValue(true),
  };
  return {
    service: new ImprovementsDismissalService(prisma as any, knowledge as any),
    prisma,
    knowledge,
  };
}

const datosDe = (prisma: any) =>
  prisma.improvementDismissal.create.mock.calls[0][0].data;

describe('dismiss — qué se guarda por fuente (FR-026/FR-026a)', () => {
  // Documento: la VERSIÓN. Lo que se descartó fue el documento tal como
  // estaba, no el documento para siempre.
  it('un documento guarda id y versión', async () => {
    const { service, prisma } = build();
    await service.dismiss('doc:D1', 'emp-1', 'está bien así');
    expect(datosDe(prisma)).toMatchObject({
      source: 'DOCUMENTO_INCONCLUSO',
      documentId: 'D1',
      documentVersion: 3,
      note: 'está bien así',
    });
  });

  // Tema: sus consultas, que son su identidad estable — la etiqueta la
  // regenera distinta cada corrida.
  it('un tema guarda las consultas que lo forman, no su id ni su etiqueta', async () => {
    const { service, prisma } = build();
    await service.dismiss('tema:T1', 'emp-1');
    expect(datosDe(prisma)).toMatchObject({
      source: 'CONSULTA_FALLIDA',
      themeQueryEventIds: ['q1', 'q2'],
    });
  });

  it('un escalado guarda su id', async () => {
    const { service, prisma } = build();
    await service.dismiss('esc:E1', 'emp-1');
    expect(datosDe(prisma)).toMatchObject({
      source: 'ESCALADO',
      escalationId: 'E1',
    });
  });
});

describe('dismiss — autorización (FR-027)', () => {
  // ⚠️ Se revalida al descartar, no se hereda de cuando se cargó la lista. Es
  // el caso que un test de mesa no encuentra: quitarle el área a alguien con
  // la lista ya en pantalla.
  it('403 si no es responsable del área del ítem', async () => {
    const { service } = build({
      knowledge: { esResponsableDeAgente: jest.fn().mockResolvedValue(false) },
    });
    await expect(service.dismiss('doc:D1', 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('no guarda nada cuando rechaza', async () => {
    const { service, prisma } = build({
      knowledge: { esResponsableDeAgente: jest.fn().mockResolvedValue(false) },
    });
    await service.dismiss('doc:D1', 'emp-1').catch(() => undefined);
    expect(prisma.improvementDismissal.create).not.toHaveBeenCalled();
  });

  it('un documento transversal exige ser responsable de todas las áreas', async () => {
    const prisma = buildFakePrisma();
    prisma.knowledgeDocument.findUnique = jest
      .fn()
      .mockResolvedValue({ version: 1, agentType: null });
    const knowledge = {
      esResponsableDeAgente: jest.fn(
        async (_i: string, a: unknown) => a !== null,
      ),
    };
    const { service } = build({ prisma, knowledge });
    await expect(service.dismiss('doc:T1', 'emp-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('dismiss — ids inválidos', () => {
  // Guardar una fila que no apunta a nada sería un descarte invisible que
  // nunca filtra: se rechaza en vez de aceptar en silencio.
  it('rechaza un prefijo desconocido', async () => {
    const { service, prisma } = build();
    await expect(service.dismiss('otro:X', 'emp-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.improvementDismissal.create).not.toHaveBeenCalled();
  });

  it('rechaza un id sin prefijo', async () => {
    const { service } = build();
    await expect(service.dismiss('D1', 'emp-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza un prefijo sin id', async () => {
    const { service } = build();
    await expect(service.dismiss('doc:', 'emp-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
