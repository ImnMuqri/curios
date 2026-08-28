import IORedis from 'ioredis';

export function createRedis(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  // BullMQ requires this to be null rather than the ioredis default.
  return new IORedis(url, { maxRetriesPerRequest: null });
}
