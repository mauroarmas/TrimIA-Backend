import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const JOB_ID = 'daily-reminder-cycle';

/**
 * Registra el job repeatable de recordatorios al arrancar el módulo.
 * BullMQ dedupe por (jobId + repeat.every): reiniciar el servidor no crea
 * ciclos duplicados.
 */
@Injectable()
export class RemindersScheduler implements OnModuleInit {
  private readonly logger = new Logger(RemindersScheduler.name);

  constructor(@InjectQueue('reminders') private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.add(
      'run-reminder-cycle',
      {},
      { repeat: { every: ONE_DAY_MS }, jobId: JOB_ID },
    );
    this.logger.log('Ciclo diario de recordatorios registrado.');
  }
}
