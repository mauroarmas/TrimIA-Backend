import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { WorkerHost } from '@nestjs/bullmq';
import { QueueShutdownService } from './queue-shutdown.service';

describe('cierre de una aplicación Nest con jobs pendientes', () => {
  it('espera al worker mientras sus conexiones siguen disponibles', async () => {
    const events: string[] = [];
    @Injectable()
    class Connection implements OnModuleDestroy {
      closed = false;
      onModuleDestroy() {
        this.closed = true;
        events.push('connection');
      }
    }
    @Module({ providers: [Connection], exports: [Connection] })
    class ConnectionsModule {}
    @Injectable()
    class Processor extends WorkerHost {
      constructor(connection: Connection) {
        super();
        Object.defineProperty(this, '_worker', {
          value: {
            close: async () => {
              await new Promise<void>((resolve) => setImmediate(resolve));
              expect(connection.closed).toBe(false);
              events.push('worker');
            },
          },
        });
      }
      async process() {}
    }
    @Module({
      imports: [DiscoveryModule, ConnectionsModule],
      providers: [QueueShutdownService, Processor],
    })
    class RootModule {}
    const app = await NestFactory.createApplicationContext(RootModule, {
      logger: false,
    });
    await app.close();
    expect(events).toEqual(['worker', 'connection']);
  });
});
