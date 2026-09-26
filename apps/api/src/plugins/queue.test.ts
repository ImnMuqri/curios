import { setTimeout as sleep } from 'node:timers/promises';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queuePlugin } from './queue.js';

describe('queuePlugin', () => {
  const rejections: unknown[] = [];
  const record = (reason: unknown) => rejections.push(reason);

  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', record);
  });

  afterEach(() => {
    process.off('unhandledRejection', record);
  });

  // A BullMQ queue runs its own startup commands in the background. Closed
  // before they finish, it goes on issuing them on a connection that is gone,
  // and each surfaces as an unhandled "Connection is closed" -- one per queue.
  // The window is after the socket connects and before startup finishes, a
  // few milliseconds wide, so this closes across a sweep of delays rather than
  // at one instant that may land either side of it.
  it('closes straight after boot without leaving a rejection behind', async () => {
    for (const delayMs of [0, 1, 2, 3, 5, 8, 12, 20]) {
      const app = Fastify();
      await app.register(queuePlugin);
      await app.ready();
      await sleep(delayMs);
      await app.close();
    }
    // Stragglers land after close resolves, not during it.
    await sleep(300);

    expect(rejections).toEqual([]);
  });

  // The wait above is bounded for this case: with maxRetriesPerRequest: null a
  // queue never becomes ready while Redis is unreachable, and an unbounded
  // wait would hang every shutdown for as long as the outage lasts.
  it('still closes when Redis is unreachable', async () => {
    const url = process.env.REDIS_URL;
    // Port 1 is reserved and nothing listens on it, so the connection is
    // refused at once and retried forever.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      const app = Fastify();
      await app.register(queuePlugin);
      await app.ready();

      const started = Date.now();
      await app.close();

      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      process.env.REDIS_URL = url;
    }
  }, 10_000);
});
