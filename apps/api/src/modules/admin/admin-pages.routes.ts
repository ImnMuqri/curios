import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MailJobData } from '@curios/core';
import { resolvePrivateFiles, type PrivateFiles } from '../store/private-files.js';
import { resolveStore, type AvatarStore } from '../pages/storage.js';
import {
  deleteAccount,
  grantMonth,
  resetConversations,
  suspendPage,
  unsuspendPage,
  viewAsOwner,
  type AdminActor,
  type AdminPagesDeps,
} from './admin-pages.service.js';

export interface AdminPagesRouteOptions {
  mailQueue?: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  /** undefined builds from the environment, null is uploads off, tests pass a stub. */
  store?: AvatarStore | null;
  /** As the store routes: undefined builds from the environment, null is off. */
  privateFiles?: PrivateFiles | null;
}

const params = z.object({ id: z.string().min(1).max(64) });
const reason = z.string().trim().min(1).max(500);
const withReason = z.object({ reason });
const withHandle = z.object({ reason, handle: z.string().trim().min(1).max(100) });

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminPagesRoutes: FastifyPluginAsyncZod<AdminPagesRouteOptions> = async (app, options) => {
  const store = resolveStore(options.store);
  const privateFiles = resolvePrivateFiles(options.privateFiles);
  const deps = (log: AdminPagesDeps['log']): AdminPagesDeps => ({
    prisma: app.prisma,
    mailQueue: options.mailQueue ?? app.mailQueue,
    store,
    privateFiles,
    log,
  });
  const actor = (request: { admin: { id: string } | null; ip: string }): AdminActor => ({
    adminId: request.admin!.id,
    ip: request.ip,
  });

  const simple = {
    suspend: suspendPage,
    unsuspend: unsuspendPage,
    'grant-month': grantMonth,
    'reset-conversations': resetConversations,
    'view-as-owner': viewAsOwner,
  } as const;

  for (const [name, run] of Object.entries(simple)) {
    app.post(`/admin/pages/:id/${name}`, { schema: { params, body: withReason } }, async (request, reply) => {
      await run(deps(request.log), actor(request), request.params.id, request.body.reason);
      return reply.status(204).send();
    });
  }

  app.delete('/admin/pages/:id', { schema: { params, body: withHandle } }, async (request, reply) => {
    await deleteAccount(deps(request.log), actor(request), request.params.id, request.body.reason, request.body.handle);
    return reply.status(204).send();
  });
};
