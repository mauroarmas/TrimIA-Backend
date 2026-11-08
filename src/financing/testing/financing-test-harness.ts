import { PrismaClient } from '@prisma/client';
export function financingTestPrisma() {
  const address = process.env.TEST_DATABASE_URL;
  if (!address) throw new Error('TEST_DATABASE_URL aislada obligatoria');
  const url = new URL(address);
  const redis = new URL(process.env.REDIS_URL || 'redis://invalid');
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5544' ||
    url.pathname !== '/trimia_020_test' ||
    !['localhost', '127.0.0.1'].includes(redis.hostname) ||
    redis.port !== '6394'
  )
    throw new Error('Solo base trimia_020_test/5544 y Redis local 6394');
  return new PrismaClient({ datasources: { db: { url: address } } });
}
