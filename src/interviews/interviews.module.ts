import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';
import { EscalationsModule } from '../escalations/escalations.module';
import { EmployeesModule } from '../employees/employees.module';
import { ImprovementsModule } from '../improvements/improvements.module';
import { InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';
import { InterviewsCandidatesService } from './interviews-candidates.service';
import { InterviewsDraftingService } from './interviews-drafting.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'interview-open' },
      { name: 'interview-close' },
    ),
    KnowledgeModule,
    EscalationsModule,
    EmployeesModule,
    // Spec 011: de acá salen los ítems. La dependencia va en UNA dirección —
    // `ImprovementsModule` no importa éste, lee `InterviewQuestion` por Prisma.
    ImprovementsModule,
  ],
  controllers: [InterviewsController],
  providers: [
    InterviewsService,
    InterviewsCandidatesService,
    InterviewsDraftingService,
  ],
  exports: [
    InterviewsService,
    InterviewsCandidatesService,
    InterviewsDraftingService,
  ],
})
export class InterviewsModule {}
