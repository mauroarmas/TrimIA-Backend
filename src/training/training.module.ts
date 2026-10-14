import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../database/prisma.module';
import { KnowledgeModule } from '../ai/knowledge/knowledge.module';
import { LlmModule } from '../ai/llm/llm.module';
import { TrainingGeneratorService } from './training-generator.service';
import { TrainingService } from './training.service';
import { TrainingSupervisorController } from './training-supervisor.controller';
import { TrainingController } from './training.controller';
import { AudioStorageService } from './services/audio-storage.service';
import { TtsService } from './services/tts.service';
import { AudioGenerationProcessor } from './processors/audio-generation.processor';
import { SimulationService } from './simulation/services/simulation.service';
import { SimulationAiService } from './simulation/services/simulation-ai.service';
import { SimulationController } from './simulation/simulation.controller';
import { SimulationSupervisorController } from './simulation/simulation-supervisor.controller';

@Module({
  imports: [
    PrismaModule,
    KnowledgeModule,
    LlmModule,
    BullModule.registerQueue({
      name: 'training-audio',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
      },
    }),
  ],
  controllers: [
    TrainingSupervisorController,
    TrainingController,
    SimulationController,
    SimulationSupervisorController,
  ],
  providers: [
    TrainingGeneratorService,
    TrainingService,
    AudioStorageService,
    TtsService,
    AudioGenerationProcessor,
    SimulationService,
    SimulationAiService,
  ],
  exports: [
    TrainingService,
    TrainingGeneratorService,
    AudioStorageService,
    TtsService,
    SimulationService,
    SimulationAiService,
  ],
})
export class TrainingModule {}
