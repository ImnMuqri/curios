import pino from 'pino';
import { prisma } from '@curios/db';
import { createAnthropicGateway } from '@curios/gateway';
import { Queue } from 'bullmq';
import { MAIL_QUEUE, type MailJobData } from '@curios/core';
import { createRedis } from './lib/redis.js';
import { createIngestionWorker } from './ingestion/ingestion.worker.js';
import { createMailWorker } from './mail/mail.worker.js';
import { createLeadWorker } from './leads/lead.worker.js';

const log = pino({ name: 'workers' });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

const connection = createRedis();
const gateway = createAnthropicGateway(apiKey);
const worker = createIngestionWorker({ connection, prisma, gateway, log });
// Its own connection: BullMQ blocks on one per worker, so sharing would let a
// slow extraction stall every outgoing verification and reset link. Held rather
// than discarded, so it can be closed on the way out.
const mailConnection = createRedis();
const mailWorker = createMailWorker({ connection: mailConnection });

// Its own connection, for the reason above: BullMQ blocks on one per worker,
// so a lead sharing the ingestion connection would wait behind a crawl.
const leadConnection = createRedis();
// A producer, not a worker -- the lead job hands the finished notification to
// the mail queue the mail worker above is already draining.
const mailProducer = new Queue<MailJobData>(MAIL_QUEUE, { connection: createRedis() });
const leadWorker = createLeadWorker({
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

log.info('workers up');
