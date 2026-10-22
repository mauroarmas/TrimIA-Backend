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
  imports: [ConfigModule, PrismaModule],
  providers: [
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
    MockStockAdapter,
    MockCreditAdapter,
    N8nCrmAdapter,
    CrmSyncService,
  ],
})
export class IntegrationsModule {}
