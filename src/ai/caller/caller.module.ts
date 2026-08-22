import { Module } from '@nestjs/common';
import { CallerResolver } from './caller.resolver';

/**
 * Resolución de quién habla (spec 005). `PrismaService` viene de `PrismaModule`,
 * que es global.
 */
@Module({
  providers: [CallerResolver],
  exports: [CallerResolver],
})
export class CallerModule {}
