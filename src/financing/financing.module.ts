import { CommercialFlowService } from './commercial-flow.service';
import { EscalationsModule } from '../escalations/escalations.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { IntegrationsModule } from '../ai/integrations/integrations.module';
import { FinancingService } from './financing.service';
import { FinancingConversationService } from './financing-conversation.service';
import { FinancingEvaluationService } from './financing-evaluation.service';
import { FinancingNoticeService } from './financing-notice.service';
import { FINANCING_NOTICE_PORT } from './financing-notice.port';
import { ChannelFinancingNoticeAdapter } from './channel-financing-notice.adapter';
import { WhatsappSenderModule } from '../messaging/whatsapp-sender.module';
@Module({
  imports: [
    PrismaModule,
    IntegrationsModule,
    EscalationsModule,
    WhatsappSenderModule,
  ],
  providers: [
    CommercialFlowService,
    FinancingService,
    FinancingConversationService,
    FinancingEvaluationService,
    FinancingNoticeService,
    {
      provide: FINANCING_NOTICE_PORT,
      useClass: ChannelFinancingNoticeAdapter,
    },
  ],
  exports: [
    CommercialFlowService,
    FinancingService,
    FinancingConversationService,
    FinancingEvaluationService,
    FinancingNoticeService,
  ],
})
export class FinancingModule {}
