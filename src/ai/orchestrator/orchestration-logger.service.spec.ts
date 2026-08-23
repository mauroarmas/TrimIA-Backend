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

function build() {
  const createMany = jest.fn().mockResolvedValue({ count: DOCS.length });
  const logger = Object.create(
    OrchestrationLogger.prototype,
  ) as OrchestrationLogger;
  Object.assign(logger, {
    prisma: { knowledgeRetrieval: { createMany } },
    logger: new Logger('test'),
  });
  return { logger, createMany };
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
