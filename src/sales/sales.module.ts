import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { CollectionsModule } from '../collections/collections.module';
import { OrchestrationLoggerModule } from '../ai/orchestrator/orchestration-logger.module';
import { ClientOnboardingService } from './client-onboarding.service';
import { SalesController } from './sales.controller';

@Module({
  imports: [ClientsModule, CollectionsModule, OrchestrationLoggerModule],
  controllers: [SalesController],
  providers: [ClientOnboardingService],
  exports: [ClientOnboardingService],
})
export class SalesModule {}
