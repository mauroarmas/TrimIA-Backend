import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
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
import { EscalationsModule } from './escalations/escalations.module';
import { ClientsModule } from './clients/clients.module';
import { CollectionsModule } from './collections/collections.module';
import { SalesModule } from './sales/sales.module';
import { DevToolsModule } from './dev-tools/dev-tools.module';
import { InterviewsModule } from './interviews/interviews.module';
import { ImprovementsModule } from './improvements/improvements.module';
import { TrainingModule } from './training/training.module';
import { ConfigService } from '@nestjs/config';
import { redisOptions } from './redis/redis-options';
import { QueueShutdownService } from './common/queue-shutdown.service';

@Module({
  imports: [
    DiscoveryModule,
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss',
                  messageFormat: '[{context}] {msg}',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        serializers: {
          req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisOptions(config),
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
    EscalationsModule,
    ClientsModule,
    CollectionsModule,
    SalesModule,
    DevToolsModule,
    InterviewsModule,
    ImprovementsModule,
    TrainingModule,
  ],
  providers: [
    QueueShutdownService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
