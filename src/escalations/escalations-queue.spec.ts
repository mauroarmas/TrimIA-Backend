import { EscalationsService } from './escalations.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { WhatsappSenderService } from '../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../ai/orchestrator/orchestration-logger.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';
import { KnowledgeAiEditService } from '../ai/knowledge/knowledge-ai-edit.service';
import { EmployeesService } from '../employees/employees.service';
import { RANGO_PERTENENCIA, resolverPertenencia } from './escalation-ownership';

/**
 * ⭐ Spec 013 — la cola de escalados prioriza por área.
 *
 * **Se prueba con Silvia, no con Diego.** Silvia es responsable de Cobranzas y
 * nada más; Diego, de las cinco áreas. Con Diego todo es propio, el orden no
 * cambia y estos tests pasarían aunque no se hubiera implementado nada — por eso
 * aparece en un solo test, el de no-regresión.
 *
 * Va en archivo aparte de `escalations.service.spec.ts` porque `listPending`
 * ahora ordena con `$queryRaw` y necesita un doble de Prisma que **ejecute** el
 * orden, no que lo devuelva armado: si el fake devolviera la lista ya ordenada,
 * el test de paginación no probaría nada.
 */

const SILVIA = 'emp-silvia';
const DIEGO = 'emp-diego';

interface CasoFake {
  id: string;
  createdAt: Date;
  area: string | null;
  delegatedToId?: string | null;
  status?: string;
}

/**
 * Doble de Prisma que aplica de verdad el orden y la paginación que pide la
 * consulta, en vez de devolver una lista fija.
 *
 * No interpreta el SQL: reimplementa la **semántica** declarada (rango de
 * pertenencia, después antigüedad, después LIMIT/OFFSET) sobre los casos del
 * test. Eso es lo que hace que T016 detecte una implementación que ordene en
 * memoria después de paginar.
 */
function buildService(casos: CasoFake[], agentesPropios: string[]) {
  const todos = casos.map((c) => ({
    ...c,
    status: c.status ?? 'PENDING',
    delegatedToId: c.delegatedToId ?? null,
  }));

  const $queryRaw = jest.fn((strings: TemplateStringsArray, ...vals: any[]) => {
    // Prisma NO aplana los fragmentos anidados hasta que el cliente real arma la
    // consulta: acá los `Prisma.sql` llegan como **valores**, no como texto. Así
    // que el fake aplana él mismo y después lee cada valor por la posición que
    // ocupa en el SQL resultante — adivinar por forma confundía 'COLLECTIONS'
    // (un agente propio, dentro del CASE) con el status.
    const aplanar = (ss: readonly string[], vv: any[]): [string, any[]] => {
      let sql = '';
      const planos: any[] = [];
      ss.forEach((parte, i) => {
        sql += parte;
        if (i >= vv.length) return;
        const v = vv[i];
        if (v && typeof v === 'object' && Array.isArray(v.strings)) {
          const [s2, v2] = aplanar(v.strings, v.values);
          sql += s2;
          planos.push(...v2);
        } else {
          sql += `\u0000${planos.length}\u0000`;
          planos.push(v);
        }
      });
      return [sql, planos];
    };

    const [sql, planos] = aplanar(strings, vals);
    const idxDe = (re: RegExp): number | null => {
      const m = sql.match(re);
      return m ? Number(m[1]) : null;
    };

    const iEmpleado = idxDe(/"delegatedToId" = \u0000(\d+)\u0000/);
    const iStatus = idxDe(/status::text = \u0000(\d+)\u0000/);
    const empleadoId: string = iEmpleado !== null ? planos[iEmpleado] : '';
    const status: string = iStatus !== null ? planos[iStatus] : 'PENDING';
    const soloMios = sql.includes('<>');

    const conRango = todos
      .filter((c) => c.status === status)
      .map((c) => ({
        caso: c,
        rango:
          RANGO_PERTENENCIA[
            resolverPertenencia(
              { area: c.area as any, delegatedToId: c.delegatedToId },
              { empleadoId, agentesPropios: agentesPropios as any },
            )
          ],
      }))
      .filter((r) => !soloMios || r.rango !== RANGO_PERTENENCIA.AJENA)
      .sort(
        (a, b) =>
          a.rango - b.rango ||
          a.caso.createdAt.getTime() - b.caso.createdAt.getTime(),
      );

    if (sql.includes('COUNT')) {
      return Promise.resolve([{ total: BigInt(conRango.length) }]);
    }
    // LIMIT / OFFSET también por posición en el SQL, no por ser "los últimos
    // números": el CASE interpola varios números antes que ellos.
    const iLimit = idxDe(/LIMIT \u0000(\d+)\u0000/);
    const iOffset = idxDe(/OFFSET \u0000(\d+)\u0000/);
    const limit: number = iLimit !== null ? planos[iLimit] : 20;
    const offset: number = iOffset !== null ? planos[iOffset] : 0;
    return Promise.resolve(
      conRango.slice(offset, offset + limit).map((r) => ({ id: r.caso.id })),
    );
  });

  const prisma = {
    $queryRaw,
    escalation: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          // Deliberadamente en orden ARBITRARIO (invertido): el servicio tiene
          // que rearmar según los ids que pidió, no confiar en este orden.
          todos
            .filter((c) => where.id.in.includes(c.id))
            .map((c) => ({
              id: c.id,
              createdAt: c.createdAt,
              status: c.status,
              delegatedToId: c.delegatedToId,
              conversation: {
                externalId: '549110000',
                channel: 'WHATSAPP',
                userType: 'CLIENTE',
                currentAgent: c.area,
              },
            }))
            .reverse(),
        ),
      ),
      count: jest.fn(),
    },
  };

  const knowledge = {
    agentesPropiosDe: jest.fn().mockResolvedValue(agentesPropios),
    assertPuedeEscribir: jest.fn(),
  };

  const service = new EscalationsService(
    prisma as unknown as PrismaService,
    {} as unknown as ConversationsService,
    {} as unknown as WhatsappSenderService,
    {} as unknown as OrchestrationLogger,
    knowledge as unknown as KnowledgeService,
    {} as unknown as EmployeesService,
    {} as unknown as KnowledgeAiEditService,
  );

  return { service, knowledge, prisma };
}

/** t=1 el más viejo. */
const t = (n: number) => new Date(2026, 0, n);

describe('listPending — la cola prioriza por área (spec 013)', () => {
  // Cobranzas es de Silvia; Ventas no; `null` no es de nadie.
  const cola: CasoFake[] = [
    { id: 'v-viejo', createdAt: t(1), area: 'SALES' },
    { id: 'sin-area', createdAt: t(2), area: null },
    { id: 'c-nuevo', createdAt: t(3), area: 'COLLECTIONS' },
    { id: 'v-nuevo', createdAt: t(4), area: 'SALES' },
    { id: 'c-viejo', createdAt: t(2.5), area: 'COLLECTIONS' },
  ];

  it('para Silvia: lo suyo primero, después lo sin área, después lo ajeno (FR-003, FR-008)', async () => {
    const { service } = buildService(cola, ['COLLECTIONS']);
    const { data } = await service.listPending({ empleadoId: SILVIA });

    expect(data.map((d: any) => d.id)).toEqual([
      'c-viejo', // propios, del más viejo al más nuevo
      'c-nuevo',
      'sin-area', // no es de nadie, pero no se hunde
      'v-viejo', // ajenos, al final, también por antigüedad
      'v-nuevo',
    ]);
    expect(data.map((d: any) => d.pertenencia)).toEqual([
      'PROPIA',
      'PROPIA',
      'SIN_AREA',
      'AJENA',
      'AJENA',
    ]);
  });

  it('no desaparece ningún caso: mismo total que ve el gerente (FR-002, SC-002)', async () => {
    const deSilvia = await buildService(cola, [
      'COLLECTIONS',
    ]).service.listPending({ empleadoId: SILVIA });
    const deDiego = await buildService(cola, [
      'SALES',
      'COLLECTIONS',
      'ADMIN',
      'LOGISTICS',
      'DEPOSITS',
    ]).service.listPending({ empleadoId: DIEGO });

    expect(deSilvia.total).toBe(deDiego.total);
    expect(deSilvia.data.map((d: any) => d.id).sort()).toEqual(
      deDiego.data.map((d: any) => d.id).sort(),
    );
  });

  it('⭐ el orden se aplica ANTES de paginar, no dentro de la página', async () => {
    // `c-viejo` y `c-nuevo` son de Silvia pero por antigüedad pura caerían en la
    // página 2 (son el 3º y 5º más viejos). Tienen que subir a la página 1.
    //
    // Éste es el único test que distingue la implementación correcta de la que
    // ordena en memoria lo ya traído: los otros pasan con las dos.
    const { service } = buildService(cola, ['COLLECTIONS']);
    const p1 = await service.listPending({ empleadoId: SILVIA, limit: 2 });

    expect(p1.data.map((d: any) => d.id)).toEqual(['c-viejo', 'c-nuevo']);
    expect(p1.total).toBe(5);
    expect(p1.hasMore).toBe(true);
  });

  it('un caso sin área aparece para todos y no queda detrás de lo ajeno (FR-007)', async () => {
    for (const [quien, areas] of [
      [SILVIA, ['COLLECTIONS']],
      [DIEGO, ['SALES', 'COLLECTIONS']],
    ] as const) {
      const { data } = await buildService(cola, [...areas]).service.listPending(
        {
          empleadoId: quien,
        },
      );
      const ids = data.map((d: any) => d.id);
      expect(ids).toContain('sin-area');
      const sinArea = data.find((d: any) => d.id === 'sin-area') as any;
      expect(sinArea.pertenencia).toBe('SIN_AREA');
    }
    // Y para Silvia va por delante de los de Ventas, que son ajenos.
    const { data } = await buildService(cola, [
      'COLLECTIONS',
    ]).service.listPending({ empleadoId: SILVIA });
    const ids = data.map((d: any) => d.id);
    expect(ids.indexOf('sin-area')).toBeLessThan(ids.indexOf('v-viejo'));
  });

  it('para el responsable de TODAS las áreas la cola no cambia (FR-005, SC-003)', async () => {
    // "No cambia nada" es el resultado correcto acá — y por eso probar solo con
    // él no probaría nada.
    const { service } = buildService(cola, [
      'SALES',
      'COLLECTIONS',
      'ADMIN',
      'LOGISTICS',
      'DEPOSITS',
    ]);
    const { data } = await service.listPending({ empleadoId: DIEGO });

    // Todo por antigüedad, salvo el sin área que no es de nadie ni siquiera
    // para él.
    expect(data.map((d: any) => d.id)).toEqual([
      'v-viejo',
      'c-viejo',
      'c-nuevo',
      'v-nuevo',
      'sin-area',
    ]);
  });

  it('un supervisor sin áreas ve todo, sin nada propio', async () => {
    const { service } = buildService(cola, []);
    const { data } = await service.listPending({ empleadoId: 'emp-nuevo' });

    expect(data).toHaveLength(5);
    expect(data.some((d: any) => d.pertenencia === 'PROPIA')).toBe(false);
  });

  it('quitarle un área cambia su cola en la consulta siguiente (FR-006, SC-005)', async () => {
    // Sin tocar ningún caso: la pertenencia se resuelve al consultar, no está
    // copiada en el caso.
    const conCobranzas = await buildService(cola, [
      'COLLECTIONS',
    ]).service.listPending({ empleadoId: SILVIA });
    const sinCobranzas = await buildService(cola, []).service.listPending({
      empleadoId: SILVIA,
    });

    expect(
      (conCobranzas.data.find((d: any) => d.id === 'c-viejo') as any)
        .pertenencia,
    ).toBe('PROPIA');
    expect(
      (sinCobranzas.data.find((d: any) => d.id === 'c-viejo') as any)
        .pertenencia,
    ).toBe('AJENA');
  });

  it('resuelve los agentes propios UNA vez por request, no por caso (SC-007)', async () => {
    const { service, knowledge } = buildService(cola, ['COLLECTIONS']);
    await service.listPending({ empleadoId: SILVIA });
    expect(knowledge.agentesPropiosDe).toHaveBeenCalledTimes(1);
  });

  it('el filtro por estado sigue andando y sale priorizado igual (FR-024)', async () => {
    const resueltos: CasoFake[] = [
      { id: 'r-ventas', createdAt: t(1), area: 'SALES', status: 'RESOLVED' },
      {
        id: 'r-cobr',
        createdAt: t(2),
        area: 'COLLECTIONS',
        status: 'RESOLVED',
      },
      { id: 'p-cobr', createdAt: t(3), area: 'COLLECTIONS' },
    ];
    const { service } = buildService(resueltos, ['COLLECTIONS']);
    const { data } = await service.listPending({
      empleadoId: SILVIA,
      status: 'RESOLVED' as any,
    });

    // Solo los RESUELTOS, y con lo propio adelante: la prioridad no puede estar
    // cableada solo en el camino de PENDING.
    expect(data.map((d: any) => d.id)).toEqual(['r-cobr', 'r-ventas']);
  });

  it('sin empleado (código interno) se comporta como antes de la spec 013', async () => {
    const { service, prisma } = buildService(cola, ['COLLECTIONS']);
    (prisma.escalation.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.escalation.count as jest.Mock).mockResolvedValueOnce(0);

    await service.listPending({});
    // Ni consulta el criterio de área ni usa la consulta ordenada.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('listPending — los derivados (spec 013, US3)', () => {
  const conDerivados: CasoFake[] = [
    { id: 'c-propio', createdAt: t(1), area: 'COLLECTIONS' },
    {
      id: 'v-para-silvia',
      createdAt: t(2),
      area: 'SALES',
      delegatedToId: SILVIA,
    },
    {
      id: 'c-para-diego',
      createdAt: t(3),
      area: 'COLLECTIONS',
      delegatedToId: DIEGO,
    },
  ];

  it('un caso de otra área derivado a mí es propio (FR-010)', async () => {
    const { service } = buildService(conDerivados, ['COLLECTIONS']);
    const { data } = await service.listPending({ empleadoId: SILVIA });
    const derivado = data.find((d: any) => d.id === 'v-para-silvia') as any;

    expect(derivado.pertenencia).toBe('PROPIA');
    // Y va entre los propios, no al fondo.
    expect(data.map((d: any) => d.id).indexOf('v-para-silvia')).toBeLessThan(
      data.map((d: any) => d.id).indexOf('c-para-diego'),
    );
  });

  it('un caso de MI área derivado a otro deja de ser propio (FR-011)', async () => {
    const { service } = buildService(conDerivados, ['COLLECTIONS']);
    const { data } = await service.listPending({ empleadoId: SILVIA });
    const ajeno = data.find((d: any) => d.id === 'c-para-diego') as any;

    // Es de Cobranzas —su área— pero ya tiene dueño, y no es ella.
    expect(ajeno.pertenencia).toBe('AJENA');
  });
});

describe('listPending — soloMios (spec 013, US4)', () => {
  const cola: CasoFake[] = [
    { id: 'c-1', createdAt: t(1), area: 'COLLECTIONS' },
    { id: 'v-1', createdAt: t(2), area: 'SALES' },
    { id: 'sin-area', createdAt: t(3), area: null },
    { id: 'v-derivado', createdAt: t(4), area: 'SALES', delegatedToId: SILVIA },
  ];

  it('devuelve lo propio, lo derivado a mí y lo sin área — y nada ajeno (FR-012)', async () => {
    const { service } = buildService(cola, ['COLLECTIONS']);
    const { data } = await service.listPending({
      empleadoId: SILVIA,
      soloMios: true,
    });

    expect(data.map((d: any) => d.id).sort()).toEqual([
      'c-1',
      'sin-area',
      'v-derivado',
    ]);
    expect(data.some((d: any) => d.pertenencia === 'AJENA')).toBe(false);
  });

  it('el total corresponde a lo restringido, no a la cola entera (FR-014)', async () => {
    const { service } = buildService(cola, ['COLLECTIONS']);
    const restringida = await service.listPending({
      empleadoId: SILVIA,
      soloMios: true,
    });
    const completa = await service.listPending({ empleadoId: SILVIA });

    expect(restringida.total).toBe(3);
    expect(completa.total).toBe(4);
  });

  it('por defecto NO restringe: el defecto es la cola completa (FR-013)', async () => {
    const { service } = buildService(cola, ['COLLECTIONS']);
    const { data } = await service.listPending({ empleadoId: SILVIA });
    expect(data).toHaveLength(4);
  });
});

describe('findById — el detalle también trae pertenencia (spec 013, FR-018)', () => {
  /**
   * El panel pisa el caso de la lista con el del detalle al abrirlo. Si el
   * detalle no trae `pertenencia`, el aviso de "esto es de otra área" no se
   * muestra nunca — y el defecto es invisible, porque la lista sí la trae.
   */
  function buildDetalle(
    area: string | null,
    delegatedToId: string | null = null,
  ) {
    const escalation = {
      id: 'esc-1',
      status: 'PENDING',
      delegatedToId,
      conversation: { id: 'conv-1', currentAgent: area },
    };
    const prisma = {
      escalation: { findUnique: jest.fn().mockResolvedValue(escalation) },
    };
    const knowledge = {
      agentesPropiosDe: jest.fn().mockResolvedValue(['COLLECTIONS']),
    };
    const service = new EscalationsService(
      prisma as unknown as PrismaService,
      {} as unknown as ConversationsService,
      {} as unknown as WhatsappSenderService,
      {} as unknown as OrchestrationLogger,
      knowledge as unknown as KnowledgeService,
      {} as unknown as EmployeesService,
      {} as unknown as KnowledgeAiEditService,
    );
    return { service, knowledge };
  }

  it('un caso de otra área viene marcado AJENA', async () => {
    const { service } = buildDetalle('SALES');
    const caso: any = await service.findById('esc-1', SILVIA);
    expect(caso.pertenencia).toBe('AJENA');
  });

  it('un caso propio viene PROPIA, y no lleva aviso', async () => {
    const { service } = buildDetalle('COLLECTIONS');
    const caso: any = await service.findById('esc-1', SILVIA);
    expect(caso.pertenencia).toBe('PROPIA');
  });

  it('un caso sin área es SIN_AREA, no AJENA: responderlo es lo esperado', async () => {
    const { service } = buildDetalle(null);
    const caso: any = await service.findById('esc-1', SILVIA);
    expect(caso.pertenencia).toBe('SIN_AREA');
  });

  it('sin empleado (código interno) el detalle sale como antes, sin pertenencia', async () => {
    const { service, knowledge } = buildDetalle('SALES');
    const caso: any = await service.findById('esc-1');
    expect(caso.pertenencia).toBeUndefined();
    expect(knowledge.agentesPropiosDe).not.toHaveBeenCalled();
  });
});
