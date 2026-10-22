import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { CollectionsModule } from '../collections/collections.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { IntegrationsModule } from '../ai/integrations/integrations.module';
import { PrismaModule } from '../database/prisma.module';
import { ClientOnboardingService } from './client-onboarding.service';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [
    ClientsModule,
    CollectionsModule,
    OrchestrationLoggerModule,
    IntegrationsModule,
    PrismaModule,
  ],
  controllers: [SalesController],
  providers: [ClientOnboardingService, SalesService],
  exports: [ClientOnboardingService, SalesService],
})
export class SalesModule {}
