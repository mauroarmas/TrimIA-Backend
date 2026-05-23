import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CheckpointerModule } from './ai/checkpointer/checkpointer.module';
import { LlmModule } from './ai/llm/llm.module';
import { AgentsModule } from './ai/agents/agents.module';
import { OrchestratorModule } from './ai/orchestrator/orchestrator.module';
import { HealthModule } from './health/health.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagingModule } from './messaging/messaging.module';
import { QueueModule } from './queue/queue.module';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        // En dev: formato legible y coloreado. En prod: JSON (para agregadores de logs)
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  // Docker ya antepone el timestamp correcto → ocultamos el de pino
                  ignore: 'pid,hostname,context,time',
                  messageFormat: '[{context}] {msg}',
                },
              }
            : undefined,
        // Recorta los objetos req/res a lo esencial (sin headers gigantes)
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    CheckpointerModule,
    LlmModule,
    AgentsModule,
    OrchestratorModule,
    HealthModule,
    ConversationsModule,
    MessagingModule,
    QueueModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}