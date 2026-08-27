/**
 * Tests de `trackRetrievals` — el enlace entre un caso y los documentos que
 * quedaron cortos (spec 007, US1).
 *
 * Sin este enlace no se le puede ofrecer al supervisor "corregí uno de estos"
 * al resolver el caso, y habría que correlacionar por fecha — que es
 * exactamente lo que el diseño descartó, porque una conversación puede escalar,
 * resolverse y volver a escalar.
 */
import { Logger } from '@nestjs/common';
import { OrchestrationLogger } from './orchestration-logger.service';
import { RetrievedDoc } from './orchestrator.state';

const DOCS: RetrievedDoc[] = [
  { documentId: 'doc-1', title: 'Sobre Nosotros', score: 62.1, rank: 0 },
  { documentId: 'doc-2', title: 'Glosario interno', score: 61.2, rank: 1 },
];

/**
 * `enPostgres` = qué documentos tienen fila en `KnowledgeDocument`.
 *
 * Por defecto, todos los que se le pasen: es el caso sano. Acotarlo simula un
 * vector huérfano en Chroma —un documento borrado del corpus cuyos chunks
 * sobrevivieron— que es lo que rompía la tanda entera.
 */
function build(enPostgres?: string[]) {
  const createMany = jest.fn().mockResolvedValue({ count: DOCS.length });
  const findMany = jest.fn().mockImplementation((args: any) => {
    const pedidos = (args?.where?.id?.in ?? []) as string[];
    const existen = enPostgres ?? pedidos;
    return Promise.resolve(
      pedidos.filter((id) => existen.includes(id)).map((id) => ({ id })),
    );
  });
  const logger = Object.create(
    OrchestrationLogger.prototype,
  ) as OrchestrationLogger;
  Object.assign(logger, {
    prisma: {
      knowledgeRetrieval: { createMany },
      knowledgeDocument: { findMany },
    },
    logger: new Logger('test'),
  });
  return { logger, createMany, findMany };
}

describe('trackRetrievals — enlace con el caso escalado', () => {
  it('persiste el escalationId en cada fila', async () => {
    const { logger, createMany } = build();

    await logger.trackRetrievals({
      conversationId: 'conv-1',
      agentType: 'SALES',
      outcome: 'ESCALATED',
      docs: DOCS,
      escalationId: 'esc-1',
    });

    const filas = createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(filas).toHaveLength(2);
    // Las DOS filas, no solo la primera: el supervisor tiene que ver todos los
    // candidatos, no el mejor.
    expect(filas.every((f) => f.escalationId === 'esc-1')).toBe(true);
  });

  it('un turno que se respondió bien queda sin caso, no con uno inventado', async () => {
    const { logger, createMany } = build();

    await logger.trackRetrievals({
      conversationId: 'conv-1',
      agentType: 'SALES',
      outcome: 'ANSWERED',
      docs: DOCS,
    });

    const filas = createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(filas.every((f) => f.escalationId === null)).toBe(true);
  });

  /**
   * La ausencia de filas ES la señal de "no había nada cercano" (escenario 5 de
   * US1): no se ofrece corregir nada y se crea un documento nuevo, como hasta
   * ahora. Por eso no hay que inventar un marcador para ese caso.
   */
  it('sin documentos recuperados no escribe nada', async () => {
    const { logger, createMany } = build();

    await logger.trackRetrievals({
      conversationId: 'conv-1',
      outcome: 'ESCALATED',
      docs: [],
      escalationId: 'esc-1',
    });

    expect(createMany).not.toHaveBeenCalled();
  });

  /**
   * Esto es telemetría y corre DESPUÉS de que la respuesta ya se le envió al
   * usuario. Un fallo acá no puede tumbar el turno: reintentar el job le
   * mandaría el mensaje dos veces.
   */
  it('un fallo al registrar no propaga la excepción', async () => {
    const { logger, createMany } = build();
    createMany.mockRejectedValueOnce(new Error('DB caída'));

    await expect(
      logger.trackRetrievals({
        conversationId: 'conv-1',
        outcome: 'ESCALATED',
        docs: DOCS,
        escalationId: 'esc-1',
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * ⭐ Regresión del defecto del 2026-08-26: un vector huérfano se llevaba puesta
 * la tanda entera.
 *
 * `createMany` es todo-o-nada. Un `documentId` que está en Chroma pero ya no en
 * Postgres viola el FK y hace fallar la inserción COMPLETA, incluidos los
 * documentos válidos del mismo turno. Envuelto en el `try` de telemetría, el
 * turno seguía normal y el caso quedaba sin candidatos — la pantalla decía "no
 * hay documentos cercanos" cuando en realidad no se habían podido guardar.
 *
 * Medido en la base real: 3 huérfanos («Prueba QA spec 007» ×2 y una nota de
 * envíos) dejaban 3 de 8 casos abiertos sin un solo candidato.
 */
describe('⭐ trackRetrievals — un huérfano no se lleva puesto el turno', () => {
  it('guarda los documentos válidos y descarta solo el que no existe', async () => {
    const { logger, createMany } = build(['doc-1']); // doc-2 quedó huérfano

    await logger.trackRetrievals({
      conversationId: 'conv-1',
      outcome: 'ESCALATED',
      docs: DOCS,
      escalationId: 'esc-1',
    });

    const filas = createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(filas).toHaveLength(1);
    expect(filas[0].documentId).toBe('doc-1');
    // Lo que importa de verdad: el caso NO se queda sin candidatos.
    expect(filas[0].escalationId).toBe('esc-1');
  });

  it('avisa qué ids son huérfanos, en vez de descartarlos en silencio', async () => {
    // Un huérfano significa que la búsqueda le devuelve al agente un documento
    // que el panel ya no muestra y que nadie puede corregir. Sin el aviso, eso
    // solo se descubre auditando Chroma contra Postgres a mano.
    const { logger } = build(['doc-1']);
    const warn = jest.fn();
    Object.assign(logger, { logger: { warn, log: jest.fn() } });

    await logger.trackRetrievals({
      conversationId: 'conv-1',
      outcome: 'ESCALATED',
      docs: DOCS,
      escalationId: 'esc-1',
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('doc-2'));
  });

  it('si TODOS son huérfanos no intenta insertar nada', async () => {
    const { logger, createMany } = build([]);

    await logger.trackRetrievals({
      conversationId: 'conv-1',
      outcome: 'ESCALATED',
      docs: DOCS,
      escalationId: 'esc-1',
    });

    expect(createMany).not.toHaveBeenCalled();
  });
});
