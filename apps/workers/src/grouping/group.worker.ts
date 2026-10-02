import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { GROUP_QUEUE, type GroupJobData } from '@curios/core';
import { QUEUE_CONCURRENCY } from '../queues.js';
import { runGroupJob, type GroupJobDeps } from './group.job.js';

export function createGroupWorker(deps: GroupJobDeps & { connection: IORedis }): Worker<GroupJobData> {
  const { connection, ...jobDeps } = deps;
  return new Worker<GroupJobData>(GROUP_QUEUE, async (job) => runGroupJob(jobDeps, job.data), {
    connection,
    concurrency: QUEUE_CONCURRENCY.group,
  });
}
