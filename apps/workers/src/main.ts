import pino from 'pino';
import { prisma } from '@curios/db';
import { createAnthropicGateway } from '@curios/gateway';
import { createOpenAiEmbedder, EMBEDDING_BATCH_TIMEOUT_MS } from '@curios/embeddings';
import { Queue } from 'bullmq';
import { BILLING_QUEUE, HOUSEKEEPING_QUEUE, MAIL_QUEUE, type MailJobData } from '@curios/core';
import { resolveApiUrl } from '@curios/core/digital';
import { paymentSecretsKey } from '@curios/core/secret-box';
import { onShutdown } from '@curios/core/shutdown';
import { createRedis, type Redis } from './lib/redis.js';
import { createObjectRemover } from './lib/storage.js';
import { createIngestionWorker } from './ingestion/ingestion.worker.js';
import { createMailWorker } from './mail/mail.worker.js';
import { createLeadWorker } from './leads/lead.worker.js';
import { createGroupWorker } from './grouping/group.worker.js';
import { billingDisabled, CHIP_DEFAULT_BASE_URL, createChipClient } from '@curios/billing';
import { createBillingWorker, scheduleBillingJobs } from './billing/pending-check.js';
import { createHousekeepingWorker, scheduleHousekeepingJobs } from './housekeeping/retention.js';

const log = pino({ name: 'workers' });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

// Switched off only in development with no CHIP settings at all -- see
// billingDisabled. Production, or a half-filled configuration, still refuses to start.
// callbackBaseUrl is read now so a missing one fails at boot rather than at the first renewal.
const billing = billingDisabled()
  ? null
  : {
      secretKey: required('CHIP_SECRET_KEY'),
      brandId: required('CHIP_BRAND_ID'),
      baseUrl: process.env.CHIP_BASE_URL || CHIP_DEFAULT_BASE_URL,
      callbackBaseUrl: required('CHIP_CALLBACK_BASE_URL'),
    };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const appUrl = process.env.APP_URL;
if (!appUrl) throw new Error('APP_URL is not set');
// Reminder emails build download links from it: throws here in production rather than mail dead links.
const apiUrl = resolveApiUrl(process.env);

// Every connection, worker and queue made below, so a deploy's SIGTERM can close them in order.
const connections: Redis[] = [];
const workers: { close: () => Promise<void> }[] = [];
const queues: { close: () => Promise<void> }[] = [];
const redis = () => {
  const made = createRedis();
  connections.push(made);
  return made;
};

const connection = redis();
const gateway = createAnthropicGateway(apiKey);

const openAiKey = process.env.OPENAI_API_KEY;
if (!openAiKey) throw new Error('OPENAI_API_KEY is not set');

// The batch timeout, not the visitor one: nothing is waiting on an
// ingestion, and a whole page of facts goes in one request.
const embedder = createOpenAiEmbedder(openAiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });

const worker = createIngestionWorker({ connection, prisma, gateway, embedder, log });
// Its own connection: BullMQ blocks on one per worker, so sharing would let a
// slow extraction stall every outgoing verification and reset link. Held rather
// than discarded, so it can be closed on the way out.
const mailConnection = redis();
const mailWorker = createMailWorker({ connection: mailConnection });

// Its own connection, for the reason above: BullMQ blocks on one per worker,
// so a lead sharing the ingestion connection would wait behind a crawl.
const leadConnection = redis();
// A producer, not a worker -- the lead job hands the finished notification to
// the mail queue the mail worker above is already draining.
const mailProducer = new Queue<MailJobData>(MAIL_QUEUE, { connection: redis() });
queues.push(mailProducer);
const leadWorker = createLeadWorker({
  appUrl,
  connection: leadConnection,
  prisma,
  gateway,
  mailQueue: mailProducer,
  log,
});

worker.on('completed', (job) => log.info({ jobId: job.id }, 'ingestion completed'));
worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'ingestion failed'));

mailWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'mail failed'),
);

// A worker emits 'error' for trouble with the queue itself rather than with a
// job -- a dropped Redis connection, most often. On an EventEmitter an 'error'
// with no listener is an uncaught exception, so without these a blip in Redis
// takes the whole process down and every queue with it. Logged and survived
// instead: BullMQ reconnects on its own.
worker.on('error', (err) => log.error({ err: err.message }, 'ingestion worker error'));
mailWorker.on('error', (err) => log.error({ err: err.message }, 'mail worker error'));
leadWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'lead notification failed'),
);
leadWorker.on('error', (err) => log.error({ err: err.message }, 'lead worker error'));

// One at a time (QUEUE_CONCURRENCY.group), on its own connection like the rest.
const groupWorker = createGroupWorker({ connection: redis(), prisma, gateway, embedder, log });
groupWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'grouping failed'));
groupWorker.on('error', (err) => log.error({ err: err.message }, 'group worker error'));

// The retention sweep, everywhere: unlike billing, deleting what PDPA says
// must be deleted cannot wait on a payment provider being configured.
// Built here, so a partial set of storage settings fails at boot, not on the night's sweep.
const housekeepingWorker = createHousekeepingWorker({ connection: redis(), prisma, removeObjects: createObjectRemover(), reminders: { mailQueue: mailProducer, appUrl, apiUrl, secretsKey: paymentSecretsKey() }, log });
housekeepingWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'housekeeping job failed'));
housekeepingWorker.on('error', (err) => log.error({ err: err.message }, 'housekeeping worker error'));
workers.push(worker, mailWorker, leadWorker, groupWorker, housekeepingWorker);
const housekeepingQueue = new Queue(HOUSEKEEPING_QUEUE, { connection: redis() });
queues.push(housekeepingQueue);
await scheduleHousekeepingJobs(housekeepingQueue);

if (billing) {
  // Its own connection, for the reason every worker above has one.
  const billingWorker = createBillingWorker({
    connection: redis(),
    prisma,
    client: createChipClient({ secretKey: billing.secretKey, brandId: billing.brandId, baseUrl: billing.baseUrl }),
    mailQueue: mailProducer,
    appUrl,
    callbackBaseUrl: billing.callbackBaseUrl,
    log,
  });
  billingWorker.on('failed', (job, err) =>
    log.error({ jobId: job?.id, err: err.message }, 'billing job failed'),
  );
  billingWorker.on('error', (err) => log.error({ err: err.message }, 'billing worker error'));
  workers.push(billingWorker);

  // The repo's first schedule. Awaited, so a Redis that cannot take it stops the process
  // here, rather than leaving a worker running with nothing ever scheduled.
  const billingQueue = new Queue(BILLING_QUEUE, { connection: redis() });
  queues.push(billingQueue);
  await scheduleBillingJobs(billingQueue);
} else {
  log.warn('No CHIP_* settings: the billing worker and its schedule are off in development.');
}

log.info('workers up');

// Workers first: close() lets a running job finish rather than leaving it to be re-run from the
// start as stalled. Then the queues, the connections under both, and the database.
onShutdown(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(queues.map((q) => q.close()));
  await Promise.all(connections.map((c) => c.quit()));
  await prisma.$disconnect();
}, log);
