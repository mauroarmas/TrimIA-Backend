import { ConfigService } from '@nestjs/config';
import { redisOptions } from './redis-options';

function settings(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('redisOptions', () => {
  it('conserva la conexión local por host y puerto', () => {
    expect(
      redisOptions(settings({ REDIS_HOST: 'redis', REDIS_PORT: 6379 })),
    ).toEqual({ host: 'redis', port: 6379 });
  });
  it('usa la URL del proveedor, su base y credenciales codificadas', () => {
    expect(
      redisOptions(
        settings({ REDIS_URL: 'redis://default:p%40ss@private-redis:6380/2' }),
      ),
    ).toEqual({
      host: 'private-redis',
      port: 6380,
      db: 2,
      username: 'default',
      password: 'p@ss',
    });
  });
  it('habilita TLS con verificación de certificado para rediss', () => {
    expect(
      redisOptions(settings({ REDIS_URL: 'rediss://redis.example.com' })),
    ).toEqual({
      host: 'redis.example.com',
      port: 6379,
      db: 0,
      tls: { servername: 'redis.example.com' },
    });
  });
  it.each(['http://redis:6379', 'redis://redis/no-es-una-base'])(
    'rechaza %s',
    (REDIS_URL) => {
      expect(() => redisOptions(settings({ REDIS_URL }))).toThrow();
    },
  );
});
