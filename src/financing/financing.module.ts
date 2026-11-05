import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { IntegrationsModule } from '../ai/integrations/integrations.module';
import { FinancingService } from './financing.service';
import { FinancingConversationService } from './financing-conversation.service';
import { FinancingEvaluationService } from './financing-evaluation.service';
import { FinancingNoticeService } from './financing-notice.service';
import { FINANCING_NOTICE_PORT } from './financing-notice.port';
import { SimulatedFinancingNoticeAdapter } from './simulated-financing-notice.adapter';
@Module({
  imports: [PrismaModule, IntegrationsModule],
  providers: [
    FinancingService,
    FinancingConversationService,
    FinancingEvaluationService,
    FinancingNoticeService,
    {
      provide: FINANCING_NOTICE_PORT,
      useClass: SimulatedFinancingNoticeAdapter,
    },
  ],
  exports: [
    FinancingService,
    FinancingConversationService,
    FinancingEvaluationService,
    FinancingNoticeService,
  ],
})
export class FinancingModule {}
