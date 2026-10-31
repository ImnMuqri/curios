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
  // The admin's own reply to a customer is not an owner notification, whatever the job says.
  if (data.audience === 'owner' && data.from !== 'support' && !settings.switches.ownerEmails) {
    // The subject says which email without saying to whom.
    log?.info({ subject: data.subject }, 'owner email held back by switch');
    return;
  }
  await mailer.send(data);
}

type SupportStatusHook = (supportMessageId: string, status: 'SENT' | 'FAILED') => Promise<void>;
type MailLog = { info: (details: object, message: string) => void; error?: (details: object, message: string) => void };

/**
 * One attempt at a job, with the support inbox's send status around it.
 *
 * SENT is written once the email has gone out; FAILED only on the final
 * attempt, since an earlier failure is retried and the admin should keep
 * seeing "sending" until the queue gives up. Either write is best effort: a
 * throw after a successful send would fail the job and the retry would send
 * the reply twice, and a throw while recording FAILED would hide the real error.
 */
export async function processMailJob(
  mailer: Mailer,
  job: { data: MailJobData; attemptsMade: number; opts: { attempts?: number } },
  settings: Settings,
  deps: { onSupportStatus?: SupportStatusHook; log?: MailLog } = {},
): Promise<void> {
  const { supportMessageId } = job.data;
  const record = async (status: 'SENT' | 'FAILED') => {
    if (!supportMessageId || !deps.onSupportStatus) return;
    try {
      await deps.onSupportStatus(supportMessageId, status);
    } catch (error) {
      deps.log?.error?.({ supportMessageId, status, err: error instanceof Error ? error.message : 'error' }, 'could not record the support send status');
    }
  };

  try {
    await sendMailJob(mailer, job.data, settings, deps.log);
  } catch (error) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await record('FAILED');
    throw error;
  }
  await record('SENT');
}

export function createMailWorker(deps: {
  connection: IORedis;
  mailer?: Mailer;
  /** The admin's settings, read for every job (cached 30 s by the reader). */
  settings: { get(): Promise<Settings> };
  /** Records a support reply's outcome; see processMailJob. */
  onSupportStatus?: SupportStatusHook;
  log?: MailLog;
}): Worker<MailJobData> {
  const mailer = deps.mailer ?? createMailer();

  return new Worker<MailJobData>(
    MAIL_QUEUE,
    async (job) => processMailJob(mailer, job, await deps.settings.get(), { onSupportStatus: deps.onSupportStatus, log: deps.log }),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.mail },
  );
}
