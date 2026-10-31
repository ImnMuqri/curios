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

type MailJobLike = { data: MailJobData; attemptsMade: number; opts: { attempts?: number } };

/** A status write that never throws: see processMailJob for why. */
async function recordStatus(
  supportMessageId: string | undefined,
  status: 'SENT' | 'FAILED',
  hook: SupportStatusHook | undefined,
  log: MailLog | undefined,
): Promise<void> {
  if (!supportMessageId || !hook) return;
  try {
    await hook(supportMessageId, status);
  } catch (error) {
    log?.error?.({ supportMessageId, status, err: error instanceof Error ? error.message : 'error' }, 'could not record the support send status');
  }
}

/**
 * One attempt at a job, with the support inbox's send status around it.
 *
 * SENT is written once the email has gone out; FAILED only on the final
 * attempt, since an earlier failure is retried and the admin should keep
 * seeing "sending" until the queue gives up. Either write is best effort: a
 * throw after a successful send would fail the job and the retry would send
 * the reply twice, and a throw while recording FAILED would hide the real error.
 * The settings are read inside, so a database that is down on the last attempt
 * still ends in FAILED rather than a reply left sending.
 */
export async function processMailJob(
  mailer: Mailer,
  job: MailJobLike,
  settings: { get(): Promise<Settings> },
  deps: { onSupportStatus?: SupportStatusHook; log?: MailLog } = {},
): Promise<void> {
  const { supportMessageId } = job.data;
  try {
    await sendMailJob(mailer, job.data, await settings.get(), deps.log);
  } catch (error) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await recordStatus(supportMessageId, 'FAILED', deps.onSupportStatus, deps.log);
    throw error;
  }
  await recordStatus(supportMessageId, 'SENT', deps.onSupportStatus, deps.log);
}

/**
 * The worker's 'failed' listener: FAILED for a job the queue has given up on. The processor writes
 * it too, but a job that stalled (its worker died mid-send) is failed by BullMQ without the processor
 * running again, so only this sees it. That failure comes before the attempts run out, with
 * finishedOn set, which a failure the queue will retry never has. The hook only turns SENDING into
 * FAILED, so the two writes agree and a reply already SENT stays SENT.
 */
export async function recordFinalFailure(
  job: (MailJobLike & { finishedOn?: number }) | undefined,
  onSupportStatus: SupportStatusHook,
  log?: MailLog,
): Promise<void> {
  if (!job) return;
  const final = job.attemptsMade >= (job.opts.attempts ?? 1) || job.finishedOn !== undefined;
  if (final) await recordStatus(job.data.supportMessageId, 'FAILED', onSupportStatus, log);
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
    async (job) => processMailJob(mailer, job, deps.settings, { onSupportStatus: deps.onSupportStatus, log: deps.log }),
    { connection: deps.connection, concurrency: QUEUE_CONCURRENCY.mail },
  );
}
