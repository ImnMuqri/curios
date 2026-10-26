import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MailJobData } from '@curios/core';
import type { AdminActor, AdminPagesDeps } from './admin-pages.service.js';
import { dismissReports, emailOwnerAboutReports } from './admin-reports.service.js';

export interface AdminReportsRouteOptions {
  mailQueue?: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
}

const params = z.object({ id: z.string().min(1).max(64) });
const withReason = z.object({ reason: z.string().trim().min(1).max(500) });

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminReportsRoutes: FastifyPluginAsyncZod<AdminReportsRouteOptions> = async (app, options) => {
  const deps = (log: AdminPagesDeps['log']): AdminPagesDeps => ({
    prisma: app.prisma,
    mailQueue: options.mailQueue ?? app.mailQueue,
    store: null,
    log,
  });
  const actor = (request: { admin: { id: string } | null; ip: string }): AdminActor => ({
    adminId: request.admin!.id,
    ip: request.ip,
  });

  const routes = { dismiss: dismissReports, 'email-owner': emailOwnerAboutReports } as const;

  for (const [name, run] of Object.entries(routes)) {
    app.post(`/admin/pages/:id/reports/${name}`, { schema: { params, body: withReason } }, async (request, reply) => {
      await run(deps(request.log), actor(request), request.params.id, request.body.reason);
      return reply.status(204).send();
    });
  }
};
