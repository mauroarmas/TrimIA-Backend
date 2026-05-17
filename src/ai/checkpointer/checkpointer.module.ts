import { Global, Module } from '@nestjs/common';
import { CheckpointerService } from './checkpointer.service';

@Global()
@Module({
  providers: [CheckpointerService],
  exports: [CheckpointerService],
})
export class CheckpointerModule {}
