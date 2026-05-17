import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      const isHealthy = pong === 'PONG';
      const result = this.getStatus(key, isHealthy);
      if (!isHealthy) {
        throw new HealthCheckError('Redis ping failed', result);
      }
      return result;
    } catch (error) {
      const result = this.getStatus(key, false, { message: (error as Error).message });
      throw new HealthCheckError('Redis check failed', result);
    }
  }
}
