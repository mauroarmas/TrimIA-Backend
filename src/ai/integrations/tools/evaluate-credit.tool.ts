import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CreditPort } from '../ports/credit.port';

export function createEvaluateCreditTool(creditPort: CreditPort) {
  return tool(
    async ({ dni, requestedAmount }) => {
      try {
        const result = await creditPort.evaluateCredit({
          dni,
          requestedAmount,
        });

        return JSON.stringify({
          dictamen: result.verdict,
          score: result.score,
          motivoTecnico: result.reason,
          condicionComercial: result.commercialCondition,
          evaluadoEl: result.assessedAt.toISOString(),
        });
      } catch (err: any) {
        return JSON.stringify({
          error: true,
          mensaje: `Error evaluando riesgo crediticio para DNI ${dni}: ${err.message}`,
        });
      }
    },
    {
      name: 'evaluate_credit',
      description:
        'Evalúa el riesgo crediticio de un solicitante a través del buró financiero Riesgo Online. USO EXCLUSIVO ADMINISTRATIVO (OE-10). Devuelve dictamen, scoring y condición de financiamiento.',
      schema: z.object({
        dni: z.string().describe('DNI o CUIT del solicitante a evaluar (sólo dígitos)'),
        requestedAmount: z.number().optional().describe('Monto estimado de la financiación solicitada'),
      }),
    },
  );
}

