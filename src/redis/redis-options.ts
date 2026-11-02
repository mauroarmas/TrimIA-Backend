import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

/** La cola y pub/sub deben conectarse al mismo Redis, también con AUTH/TLS. */
export function redisOptions(config: ConfigService): RedisOptions {
  const address = config.get<string>('REDIS_URL');
  if (!address) {
    return {
      host: config.get<string>('REDIS_HOST'),
      port: config.get<number>('REDIS_PORT'),
    };
  }
  const url = new URL(address);
  if (!['redis:', 'rediss:'].includes(url.protocol))
    throw new Error('REDIS_URL debe usar redis:// o rediss://');
  const db = url.pathname.slice(1) || '0';
  if (!/^\d+$/.test(db))
    throw new Error('La base de REDIS_URL debe ser un entero');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(db),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:'
      ? { tls: { servername: url.hostname } }
      : {}),
  };
}
