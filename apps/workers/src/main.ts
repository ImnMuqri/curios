import pino from 'pino';
import { prisma } from '@curios/db';
import { createAnthropicGateway } from '@curios/gateway';
import { createRedis } from './lib/redis.js';
import { createIngestionWorker } from './ingestion/ingestion.worker.js';

const log = pino({ name: 'workers' });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

const connection = createRedis();
const gateway = createAnthropicGateway(apiKey);
const worker = createIngestionWorker({ connection, prisma, gateway });

worker.on('completed', (job) => log.info({ jobId: job.id }, 'ingestion completed'));
worker.on('failed', (job, err) => log.error({ jobId: job?.id, err: err.message }, 'ingestion failed'));

log.info('workers up');
