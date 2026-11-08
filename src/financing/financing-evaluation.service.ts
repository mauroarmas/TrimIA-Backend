import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  CREDIT_PORT,
  CreditPort,
  CreditAssessmentResult,
} from '../ai/integrations/ports/credit.port';
@Injectable()
export class FinancingEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CREDIT_PORT) private readonly credit: CreditPort,
  ) {}
  async evaluate(id: string, version: number) {
    const request = await this.prisma.purchaseRequest.findUnique({
      where: { id },
    });
    if (
      !request ||
      request.status !== 'PENDING_REVIEW' ||
      request.version !== version ||
      request.evaluationState !== 'PENDING' ||
      !request.inputSnapshot
    )
      return;
    const snapshot = request.inputSnapshot as any;
    let result: CreditAssessmentResult;
    try {
      result = await this.credit.evaluateCredit({
        dni: snapshot.dni,
        fullName: snapshot.name,
        requestedAmount: Number(snapshot.amount),
      });
    } catch {
      result = {
        verdict: 'UNAVAILABLE',
        score: 0,
        reason: 'Evaluación simulada no disponible; requiere revisión humana.',
        assessedAt: new Date(),
      };
    }
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.purchaseRequest.updateMany({
        where: {
          id,
          version,
          status: 'PENDING_REVIEW',
          evaluationState: 'PENDING',
        },
        data: { evaluationState: 'READY' },
      });
      if (claim.count !== 1) return;
      await tx.creditAssessment.create({
        data: {
          clientId: request.clientId,
          purchaseRequestId: id,
          requestVersion: version,
          inputSnapshot: request.inputSnapshot!,
          verdict: result.verdict,
          source: 'MOCK',
          reason: result.reason,
          rawPayload: JSON.parse(
            JSON.stringify(result),
          ) as Prisma.InputJsonObject,
        },
      });
      await tx.orchestrationEvent.create({
        data: {
          conversationId: request.conversationId,
          eventType: 'FINANCING_EVALUATED',
          payload: { requestId: id, requestVersion: version },
        },
      });
    });
  }
}
