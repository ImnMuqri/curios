import { PUSH_QUEUE, type PushJobData } from '@curios/core';

export interface OwnerPushQueue {
  add(name: string, data: PushJobData, opts?: unknown): Promise<unknown>;
}

type Warn = (details: object, message: string) => void;

/**
 * Queues a push to the owner's devices (apps/workers sends it). Not awaited and never throws, as
 * the order emails are not: the reply to the customer never waits on the queue, and an order is
 * placed or paid whether or not its notification could be queued. A missing queue (a test that
 * gave none) queues nothing.
 */
export function queueOwnerPush(queue: OwnerPushQueue | undefined, data: PushJobData, warn?: Warn): void {
  if (!queue) return;
  const fail = (error: unknown) => warn?.({ err: error instanceof Error ? error.message : String(error) }, 'could not queue the owner push');
  try {
    void queue
      .add(PUSH_QUEUE, data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: 100 })
      .catch(fail);
  } catch (error) {
    fail(error);
  }
}
