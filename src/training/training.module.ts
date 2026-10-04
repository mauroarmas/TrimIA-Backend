import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';
import { LlmModule } from '../ai/llm/llm.module';
import { TrainingGeneratorService } from './training-generator.service';
import { TrainingService } from './training.service';
import { TrainingSupervisorController } from './training-supervisor.controller';
import { TrainingController } from './training.controller';

@Module({
  imports: [PrismaModule, KnowledgeModule, LlmModule],
  controllers: [TrainingSupervisorController, TrainingController],
  providers: [TrainingGeneratorService, TrainingService],
  exports: [TrainingService, TrainingGeneratorService],
})
export class TrainingModule {}
