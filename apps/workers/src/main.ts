import pino from 'pino';
import { prisma } from '@curios/db';
import { createAnthropicGateway } from '@curios/gateway';
import { createRedis } from './lib/redis.js';
import { createIngestionWorker } from './ingestion/ingestion.worker.js';
import { createMailWorker } from './mail/mail.worker.js';

const log = pino({ name: 'workers' });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

const connection = createRedis();
const gateway = createAnthropicGateway(apiKey);
const worker = createIngestionWorker({ connection, prisma, gateway });
// Its own connection: BullMQ blocks on one per worker, so sharing would let a
// slow extraction stall every outgoing verification and reset link.
const mailWorker = createMailWorker({ connection: createRedis() });

worker.on('completed', (job) => log.info({ jobId: job.id }, 'ingestion completed'));
worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'ingestion failed'));

mailWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, 'mail failed'),
);

log.info('workers up');
