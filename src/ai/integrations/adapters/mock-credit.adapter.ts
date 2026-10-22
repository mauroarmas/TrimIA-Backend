import { Injectable, Logger } from '@nestjs/common';
import { CreditVerdict } from '@prisma/client';
import {
  CreditAssessmentResult,
  CreditEvaluationInput,
  CreditPort,
} from '../ports/credit.port';

@Injectable()
export class MockCreditAdapter implements CreditPort {
  private readonly logger = new Logger(MockCreditAdapter.name);

  async evaluateCredit(input: CreditEvaluationInput): Promise<CreditAssessmentResult> {
    const cleanDni = input.dni.replace(/\D/g, '');
    const lastDigit = cleanDni.slice(-1);

    // RF10: Simulación de corte/indisponibilidad de servicio
    if (cleanDni === '00000000' || cleanDni.length < 7) {
      this.logger.warn(`Evaluación de crédito para DNI ${cleanDni}: servicio no disponible (fallback RF10)`);
      return {
        verdict: CreditVerdict.UNAVAILABLE,
        score: 0,
        reason: 'Servicio de Riesgo Online temporalmente no disponible. Requiere verificación manual.',
        commercialCondition: 'Verificación crediticia demorada. Un supervisor administrativo revisará la solicitud.',
        assessedAt: new Date(),
      };
    }

    // Reglas determinísticas basadas en el último dígito del DNI para tests reproducibles
    if (lastDigit === '8' || lastDigit === '0') {
      return {
        verdict: CreditVerdict.APPROVED,
        score: 820,
        reason: 'Perfil sin antecedentes negativos. Scoring Veraz/BCRA Nivel 1 (Excelente).',
        commercialCondition: 'Aprobado para financiación hasta 24 cuotas semanales sin anticipo.',
        rawReport: {
          bcraSituation: 1,
          totalDebt: 0,
          inquiriesLastMonth: 1,
          bureauScore: 820,
        },
        assessedAt: new Date(),
      };
    }

    if (lastDigit === '4' || lastDigit === '6' || lastDigit === '2') {
      return {
        verdict: CreditVerdict.APPROVED_WITH_CONDITIONS,
        score: 640,
        reason: 'Scoring medio. Relación cuota/ingreso ajustada o sin historial bancario suficiente.',
        commercialCondition: 'Aprobado condicionado a un anticipo del 20% y máximo 12 cuotas semanales.',
        rawReport: {
          bcraSituation: 2,
          totalDebt: 120000,
          inquiriesLastMonth: 3,
          bureauScore: 640,
        },
        assessedAt: new Date(),
      };
    }

    // Impar o cualquier otro (ej. 1, 3, 5, 7, 9)
    return {
      verdict: CreditVerdict.REJECTED,
      score: 410,
      reason: 'Historial de mora reciente en el sistema financiero (BCRA Situación 3 o superior).',
      commercialCondition: 'No califica para venta en cuotas. Únicamente venta contado efectivo o transferencia.',
      rawReport: {
        bcraSituation: 4,
        totalDebt: 850000,
        inquiriesLastMonth: 6,
        bureauScore: 410,
      },
      assessedAt: new Date(),
    };
  }
}

