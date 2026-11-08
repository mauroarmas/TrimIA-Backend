import { Inject, Injectable } from '@nestjs/common';
import {
  CREDIT_PORT,
  CreditPort,
  CreditEvaluationInput,
  CreditAssessmentResult,
} from './ports/credit.port';
import { PrismaService } from '../../database/prisma.service';
import { esResponsableDeTodasLasAreas } from '../../employees/area-responsibility';

export function commercialCredit(assessment: CreditAssessmentResult) {
  return {
    verdict: assessment.verdict,
    commercialCondition:
      assessment.commercialCondition ??
      (assessment.verdict === 'UNAVAILABLE'
        ? 'Verificación no disponible. Requiere revisión manual de Administración.'
        : 'Sin condiciones comerciales especiales informadas por Administración.'),
    evaluatedAt: assessment.assessedAt,
  };
}

@Injectable()
export class AdministrativeCreditService {
  constructor(
    @Inject(CREDIT_PORT) private readonly credit: CreditPort,
    private readonly prisma: PrismaService,
  ) {}
  private async assess(
    input: CreditEvaluationInput,
  ): Promise<CreditAssessmentResult> {
    try {
      return await this.credit.evaluateCredit(input);
    } catch {
      return {
        verdict: 'UNAVAILABLE',
        score: 0,
        reason: 'Servicio no disponible',
        commercialCondition:
          'Verificación no disponible. Requiere revisión manual de Administración.',
        assessedAt: new Date(),
      };
    }
  }
  async commercial(input: CreditEvaluationInput) {
    return commercialCredit(await this.assess(input));
  }
  async forCaller(input: CreditEvaluationInput, employeeId?: string) {
    const assessment = await this.assess(input);
    const safe = commercialCredit(assessment);
    if (!employeeId) return safe;
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { sector: true, areasSupervisadas: true },
    });
    if (!employee?.isActive) return safe;
    const admin = employee.sector?.agentType === 'ADMIN';
    const supervisor =
      employee.role === 'SUPERVISOR' &&
      (employee.areasSupervisadas.some((area) => area.agentType === 'ADMIN') ||
        esResponsableDeTodasLasAreas(
          employee.areasSupervisadas.length,
          await this.prisma.sector.count(),
        ));
    return admin || supervisor
      ? { ...safe, score: assessment.score, motivoTecnico: assessment.reason }
      : safe;
  }
}
