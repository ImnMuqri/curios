import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BillingNotConfiguredError } from '../billing/billing.routes.js';
import type { ChipMessages } from '../billing/chip-message.js';
import type { AdminActor } from './admin-pages.service.js';
import { replayWebhook } from './admin-payments.service.js';

export interface AdminPaymentsRouteOptions {
  /**
   * The handler CHIP's own routes hand verified messages to, built once in app.ts, so a
   * replay goes through the same code and the same CHIP client. Null when billing is
   * switched off, where there is nothing to replay against.
   */
  messages: ChipMessages | null;
}

const params = z.object({ id: z.string().min(1).max(64) });
const withReason = z.object({ reason: z.string().trim().min(1).max(500) });

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminPaymentsRoutes: FastifyPluginAsyncZod<AdminPaymentsRouteOptions> = async (app, options) => {
  const actor = (request: { admin: { id: string } | null; ip: string }): AdminActor => ({
    adminId: request.admin!.id,
    ip: request.ip,
  });

  app.post(
    '/admin/webhooks/:id/replay',
    { schema: { params, body: withReason, response: { 200: z.object({ status: z.string() }) } } },
    async (request, reply) => {
      if (!options.messages) throw new BillingNotConfiguredError();
      const result = await replayWebhook(
        { ...options.messages, log: request.log },
        actor(request),
        request.params.id,
        request.body.reason,
      );
      return reply.send(result);
    },
  );
};
