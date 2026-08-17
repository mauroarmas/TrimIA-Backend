import { Module } from '@nestjs/common';
import { SupervisorController } from './supervisor.controller';
import { SupervisorService } from './supervisor.service';
import { EscalationsModule } from '../escalations/escalations.module';
import { ConversationsModule } from '../conversations/conversations.module';

/**
 * Panel del Supervisor (módulo de gobernanza / entregable E4).
 * PrismaService viene de PrismaModule (@Global). EscalationsModule y
 * ConversationsModule aportan la cola de pendientes y el control manual
 * (Sprint 3 — human-in-the-loop).
 */
@Module({
  imports: [EscalationsModule, ConversationsModule],
  controllers: [SupervisorController],
  providers: [SupervisorService],
})
export class SupervisorModule {}
