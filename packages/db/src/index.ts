import { PrismaClient } from '@prisma/client';

// Next dev-mode hot reload re-evaluates modules; without the global the process
// accumulates a new pool on every reload until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';

export { recordModelCall } from './model-call.js';
export type { ModelCallFields } from './model-call.js';

export { syncFactEmbeddings } from './fact-embedding.js';

export { MergeWouldDropAnswerError, mergeTopics, moveWording, refreshTopic, retireSlug } from './topics.js';

export { questionVectors, shortlistTopics } from './question-match.js';

export { releaseOrderStock } from './order-stock.js';
