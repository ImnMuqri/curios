import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { MAIL_QUEUE, type MailJobData } from '@curios/core';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { createMailer, type Mailer } from './transport.js';

/**
 * The job body, separated from the BullMQ wiring so it can be tested without a
 * Redis connection.
 *
 * A failure is deliberately allowed to escape. Returning quietly would mark the
 * job complete and lose the message, and there is no longer an HTTP caller to
 * notice -- the retry is now the only thing that gets a verification or reset
 * link delivered at all.
 */
export async function sendMailJob(mailer: Mailer, data: MailJobData): Promise<void> {
  await mailer.send(data);
}

export function createMailWorker(deps: {
  connection: IORedis;
  mailer?: Mailer;
}): Worker<MailJobData> {
  const mailer = deps.mailer ?? createMailer();

  return new Worker<MailJobData>(
    MAIL_QUEUE,
    async (job) => sendMailJob(mailer, job.data),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.mail },
  );
}
