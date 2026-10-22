import { CreditVerdict } from '@prisma/client';

export interface CreditEvaluationInput {
  dni: string;
  fullName?: string;
  requestedAmount?: number;
}

export interface CreditAssessmentResult {
  verdict: CreditVerdict; // APPROVED | APPROVED_WITH_CONDITIONS | REJECTED | UNAVAILABLE
  score: number;          // 0 a 1000
  reason: string;         // Explicación técnica (confidencial para ADMIN)
  commercialCondition?: string; // Condición comercial para el vendedor (ej. "Anticipo 20%")
  rawReport?: Record<string, any>; // Informe detallado del buró (CONFIDENCIAL)
  assessedAt: Date;
}

export const CREDIT_PORT = Symbol('CREDIT_PORT');

export interface CreditPort {
  /**
   * Evalúa el perfil crediticio a través de Riesgo Online (RF10).
   * Acceso exclusivo del agente ADMIN y supervisores autorizados (OE-10).
   */
  evaluateCredit(input: CreditEvaluationInput): Promise<CreditAssessmentResult>;
}

