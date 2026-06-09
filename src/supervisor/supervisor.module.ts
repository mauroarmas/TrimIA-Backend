import { Module } from '@nestjs/common';
import { SupervisorController } from './supervisor.controller';
import { SupervisorService } from './supervisor.service';

/**
 * Panel del Supervisor (módulo de gobernanza / entregable E4).
 * Solo lee datos que el sistema ya genera. PrismaService viene de PrismaModule (@Global).
 */
@Module({
  controllers: [SupervisorController],
  providers: [SupervisorService],
})
export class SupervisorModule {}