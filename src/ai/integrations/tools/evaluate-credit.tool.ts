import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { CreditPort } from '../ports/credit.port';
import {
  AdministrativeCreditService,
  commercialCredit,
} from '../administrative-credit.service';

export function createEvaluateCreditTool(
  credit: AdministrativeCreditService | CreditPort,
) {
  return tool(
    async ({ dni, requestedAmount }, config) => {
      const input = { dni, requestedAmount };
      if ('forCaller' in credit)
        return JSON.stringify(
          await credit.forCaller(input, config?.configurable?.callerEmployeeId),
        );
      // Compatibilidad de adaptadores de evaluación: sin identidad administrativa, siempre proyección comercial.
      try {
        return JSON.stringify(
          commercialCredit(await credit.evaluateCredit(input)),
        );
      } catch {
        return JSON.stringify({
          verdict: 'UNAVAILABLE',
          commercialCondition: 'Requiere revisión manual de Administración.',
          evaluatedAt: new Date().toISOString(),
        });
      }
    },
    {
      name: 'evaluate_credit',
      description:
        'Solicita a Administración el dictamen crediticio. El servidor decide si corresponde mostrar detalle técnico; no autoriza una venta.',
      schema: z.object({
        dni: z.string().trim().min(1),
        requestedAmount: z.number().positive().optional(),
      }),
    },
  );
}
