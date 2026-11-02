import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';

/** Vive en AppModule: termina los jobs antes de destruir Prisma y Redis.
 * BullMQ cierra sus workers en onApplicationShutdown, que por sí solo llega
 * después de los onModuleDestroy de las conexiones usadas por los jobs.
 */
@Injectable()
export class QueueShutdownService implements OnModuleDestroy {
  constructor(private readonly discovery: DiscoveryService) {}

  async onModuleDestroy() {
    const processors = this.discovery
      .getProviders()
      .map((provider) => provider.instance)
      .filter(
        (instance): instance is WorkerHost => instance instanceof WorkerHost,
      );
    await Promise.all(processors.map((processor) => processor.worker.close()));
  }
}
