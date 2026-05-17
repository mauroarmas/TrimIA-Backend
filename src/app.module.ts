import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CheckpointerModule } from './ai/checkpointer/checkpointer.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // Orden importante: Config primero, luego infra que depende de env vars
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      },
    }),
    PrismaModule,
    RedisModule,
    // CheckpointerModule crea las tablas de LangGraph antes que los módulos de agentes
    CheckpointerModule,
    HealthModule,
  ],
})
export class AppModule {}
