import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MailJobData } from '@curios/core';
import { resolvePrivateFiles, type PrivateFiles } from '../store/private-files.js';
import {
  countThreads,
  findAttachment,
  getThread,
  listThreads,
  markRead,
  reply,
  retry,
  setStatus,
  type AdminSupportDeps,
} from './admin-support.service.js';
import { adminActor } from './audit.js';

export interface AdminSupportRouteOptions {
  mailQueue?: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  /** As the store routes: undefined builds from the environment, null is off, tests pass a disk store. */
  privateFiles?: PrivateFiles | null;
}

const params = z.object({ id: z.string().min(1).max(64) });
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Not a date.');
const listQuery = z.object({
  status: z.enum(['open', 'done', 'spam', 'all']).default('open'),
  q: z.string().max(200).optional(),
  before: iso.optional(),
});

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminSupportRoutes: FastifyPluginAsyncZod<AdminSupportRouteOptions> = async (app, options) => {
  const files = resolvePrivateFiles(options.privateFiles);
  const deps = async (log?: AdminSupportDeps['log']): Promise<AdminSupportDeps> => ({
    prisma: app.prisma,
    mailQueue: options.mailQueue ?? app.mailQueue,
    privateFiles: files,
    freeLeads: (await app.settings.get()).freeLeads,
    log,
  });

  app.get('/admin/support/threads', { schema: { querystring: listQuery } }, async (request) => {
    const { status, q, before } = request.query;
    return listThreads(await deps(), { status, q, before: before ? new Date(before) : undefined });
  });

  app.get('/admin/support/counts', async () => countThreads(await deps()));

  app.get('/admin/support/threads/:id', { schema: { params } }, async (request) => getThread(await deps(request.log), request.params.id));

  app.get('/admin/support/attachments/:id', { schema: { params }, exposeHeadRoute: false }, async (request, res) => {
    const d = await deps();
    const attachment = await findAttachment(d, request.params.id);
    const delivery = await d.privateFiles!.deliver(attachment.storageKey, attachment.fileName);
    res.header('Cache-Control', 'private, no-store');
    if ('redirect' in delivery) return res.redirect(delivery.redirect, 302);
    return res
      .header('Content-Type', delivery.contentType)
      .header('Content-Disposition', delivery.disposition)
      .header('X-Content-Type-Options', 'nosniff')
      // No Content-Length: sizeBytes is Resend's word for it, and a wrong one cuts the file short.
      .send(delivery.stream);
  });

  app.post('/admin/support/threads/:id/read', { schema: { params } }, async (request, res) => {
    await markRead(await deps(), request.params.id);
    return res.status(204).send();
  });

  app.post(
    '/admin/support/threads/:id/status',
    { schema: { params, body: z.object({ status: z.enum(['OPEN', 'DONE']) }) } },
    async (request, res) => {
      await setStatus(await deps(), adminActor(request), request.params.id, request.body.status);
      return res.status(204).send();
    },
  );

  app.post(
    '/admin/support/threads/:id/reply',
    { schema: { params, body: z.object({ text: z.string().trim().min(1).max(20000) }) } },
    async (request) => reply(await deps(request.log), adminActor(request), request.params.id, request.body.text),
  );

  app.post('/admin/support/messages/:id/retry', { schema: { params } }, async (request, res) => {
    await retry(await deps(request.log), request.params.id);
    return res.status(204).send();
  });
};
