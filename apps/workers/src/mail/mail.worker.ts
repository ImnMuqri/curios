import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { MAIL_QUEUE, type MailJobData } from '@curios/core';
import type { Settings } from '@curios/core/settings';
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
 *
 * An owner's notification (`audience: 'owner'`) is dropped while the admin has
 * "Emails to owners" off: stopped, not held (the job completes), and logged.
 * Everything else -- sign-in and password emails, customers' and the admin's
 * own -- goes whatever the switch says.
 */
export async function sendMailJob(
  mailer: Mailer,
  data: MailJobData,
  settings: Settings,
  log?: { info: (details: object, message: string) => void },
): Promise<void> {
  if (data.audience === 'owner' && !settings.switches.ownerEmails) {
    // The subject says which email without saying to whom.
    log?.info({ subject: data.subject }, 'owner email held back by switch');
    return;
  }
  await mailer.send(data);
}

export function createMailWorker(deps: {
  connection: IORedis;
  mailer?: Mailer;
  /** The admin's settings, read for every job (cached 30 s by the reader). */
  settings: { get(): Promise<Settings> };
  log?: { info: (details: object, message: string) => void };
}): Worker<MailJobData> {
  const mailer = deps.mailer ?? createMailer();

  return new Worker<MailJobData>(
    MAIL_QUEUE,
    async (job) => sendMailJob(mailer, job.data, await deps.settings.get(), deps.log),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.mail },
  );
}
