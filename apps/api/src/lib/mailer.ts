import { MAIL_QUEUE, type MailJobData } from '@curios/core';

export type MailMessage = MailJobData;

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * The slice of BullMQ's Queue this needs, and nothing more, so a test can pass
 * a plain object and the API never depends on how the worker sends.
 */
export type MailQueue = {
  add(name: string, data: MailJobData, options?: unknown): Promise<unknown>;
};

/**
 * How mail leaves an HTTP request in this system: it does not.
 *
 * The API only ever enqueues. `apps/workers` owns the SMTP transport, which is
 * what keeps the two apps from importing each other, and the build spec's rule
 * that nothing slow runs inside a request.
 *
 * Two security properties fall out of that rather than being bolted on. A send
 * that fails no longer fails the request that triggered it, so a signup cannot
 * leave an account written but unreachable -- the trap the existing-account
 * re-send branch exists to dig people out of. And forgot-password costs the
 * same for an address that has an account and one that does not, because
 * neither waits for SMTP; without that, response time answers the question the
 * identical response body refuses to.
 */
export function createQueueMailer(queue: MailQueue): Mailer {
  return {
    async send(message: MailMessage): Promise<void> {
      await queue.add(MAIL_QUEUE, message, {
        // Mail is worth retrying and cheap to retry. Nobody is waiting on it,
        // so the backoff can be patient.
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        // Bounded, not kept. A job that exhausts its attempts still holds the
        // recipient's address and a working verification or reset URL, and a
        // reset link is only valid for an hour anyway -- so an unbounded failed
        // set is a growing pile of live credentials in Redis. An hour is long
        // enough to read the failure off the worker's log and go looking.
        removeOnFail: { age: 3600 },
      });
    },
  };
}
