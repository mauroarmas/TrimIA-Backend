import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';

@Injectable()
export class CheckpointerService implements OnModuleInit {
  readonly saver: PostgresSaver;

  constructor(private readonly config: ConfigService) {
    const pool = new Pool({
      connectionString: this.config.get<string>('DATABASE_URL'),
      max: this.config.get<number>('POSTGRES_SAVER_POOL_MAX') ?? 5,
    });
    this.saver = new PostgresSaver(pool);
  }

  async onModuleInit() {
    await this.saver.setup();
  }
}
