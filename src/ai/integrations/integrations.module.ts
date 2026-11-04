import { ConversationContactService } from './conversation-contact.service';
import { BullModule } from '@nestjs/bullmq';
import { CrmSyncProcessor } from './crm-sync.processor';
import { AdministrativeCreditService } from './administrative-credit.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../database/prisma.module';
import { STOCK_PORT } from './ports/stock.port';
import { CREDIT_PORT } from './ports/credit.port';
import { CRM_PORT } from './ports/crm.port';
import { MockStockAdapter } from './adapters/mock-stock.adapter';
import { MockCreditAdapter } from './adapters/mock-credit.adapter';
import { N8nCrmAdapter } from './adapters/n8n-crm.adapter';
import { CrmSyncService } from './crm-sync.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueue({ name: 'crm-sync' }),
  ],
  providers: [
    CrmSyncProcessor,
    AdministrativeCreditService,
    ConversationContactService,
    MockStockAdapter,
    MockCreditAdapter,
    N8nCrmAdapter,
    CrmSyncService,
    {
      provide: STOCK_PORT,
      useClass: MockStockAdapter,
    },
    {
      provide: CREDIT_PORT,
      useClass: MockCreditAdapter,
    },
    {
      provide: CRM_PORT,
      useClass: N8nCrmAdapter,
    },
  ],
  exports: [
    STOCK_PORT,
    CREDIT_PORT,
    CRM_PORT,
    AdministrativeCreditService,
    ConversationContactService,
    MockStockAdapter,
    MockCreditAdapter,
    N8nCrmAdapter,
    CrmSyncService,
  ],
})
export class IntegrationsModule {}
