import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppConfigModule } from './common/config/config.module';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { LlmModule } from './ai/llm/llm.module';
import { KnowledgeModule } from './ai/knowledge/knowledge.module';
import { AgentsModule } from './ai/agents/agents.module';
import { OrchestratorModule } from './ai/orchestrator/orchestrator.module';
import { HealthModule } from './common/health/health.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagingModule } from './messaging/messaging.module';
import { QueueModule } from './queue/queue.module';
import { SupervisorModule } from './supervisor/supervisor.module';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport: process.env.NODE_ENV !== 'production' ? {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss',
            messageFormat: '[{context}] {msg}',
            ignore: 'pid,hostname',
          },
        } : undefined,
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
    LlmModule,
    KnowledgeModule,
    AgentsModule,
    OrchestratorModule,
    HealthModule,
    ConversationsModule,
    MessagingModule,
    QueueModule,
    SupervisorModule,
    AuthModule,
    EmployeesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }