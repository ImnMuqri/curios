import type { FastifyInstance } from 'fastify';
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
  type AdminPagesDeps,
} from './admin-pages.service.js';
import { adminActor } from './audit.js';

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

/**
 * The services' deps for one request, from the parts fixed at registration. Shared with the reports
 * routes, which act on pages too but never remove a file.
 */
export function adminPagesDeps(
  app: FastifyInstance,
  parts: { mailQueue?: AdminPagesRouteOptions['mailQueue']; store: AvatarStore | null; privateFiles?: PrivateFiles | null },
): (log: AdminPagesDeps['log']) => AdminPagesDeps {
  return (log) => ({ prisma: app.prisma, mailQueue: parts.mailQueue ?? app.mailQueue, store: parts.store, privateFiles: parts.privateFiles, log });
}

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminPagesRoutes: FastifyPluginAsyncZod<AdminPagesRouteOptions> = async (app, options) => {
  const deps = adminPagesDeps(app, {
    mailQueue: options.mailQueue,
    store: resolveStore(options.store),
    privateFiles: resolvePrivateFiles(options.privateFiles),
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
      await run(deps(request.log), adminActor(request), request.params.id, request.body.reason);
      return reply.status(204).send();
    });
  }

  app.delete('/admin/pages/:id', { schema: { params, body: withHandle } }, async (request, reply) => {
    await deleteAccount(deps(request.log), adminActor(request), request.params.id, request.body.reason, request.body.handle);
    return reply.status(204).send();
  });
};
