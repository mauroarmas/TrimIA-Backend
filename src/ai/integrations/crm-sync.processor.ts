import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CrmSyncService } from './crm-sync.service';

/** Reintento periódico de los PENDING locales sobre el BullMQ existente. */
@Injectable()
@Processor('crm-sync', { concurrency: 1 })
export class CrmSyncProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly sync: CrmSyncService,
    @InjectQueue('crm-sync') private readonly queue: Queue,
  ) {
    super();
  }
  async onModuleInit() {
    await this.queue.add(
      'sync-pending',
      {},
      {
        repeat: { every: 60000 },
        jobId: 'crm-pending',
        removeOnComplete: true,
        removeOnFail: 10,
      },
    );
  }
  async process() {
    return this.sync.syncPendingProspects();
  }
}
