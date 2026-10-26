import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BANNER_MAX, PRICE_MAX_RM } from '@curios/core';
import type { AdminActor } from './admin-pages.service.js';
import { setBanner, setLimits, setSwitch } from './admin-settings.service.js';

const reason = z.string().trim().min(1).max(500);
const switchParams = z.object({ key: z.enum(['chat', 'signups', 'reading', 'chipPayments', 'ownerEmails']) });
const switchBody = z
  .object({ on: z.boolean(), reason: reason.optional() })
  .refine((b) => b.on || b.reason !== undefined, { message: 'Say why you are turning it off.', path: ['reason'] });
const limitsBody = z.object({
  cap: z.number().int().min(1).max(100000),
  freeLeads: z.number().int().min(0).max(1000),
  freeOrders: z.number().int().min(0).max(1000),
  monthlyRm: z.number().int().min(1).max(PRICE_MAX_RM * 10),
  yearlyRm: z.number().int().min(1).max(PRICE_MAX_RM * 10),
  reason,
  confirmBig: z.boolean().optional(),
});
const bannerBody = z.object({ text: z.string().trim().min(1).max(BANNER_MAX).nullable(), reason: reason.optional() });

/** Every route here sits behind requireAdmin, added by the scope that registers this plugin. */
export const adminSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const actor = (request: { admin: { id: string } | null; ip: string }): AdminActor => ({
    adminId: request.admin!.id,
    ip: request.ip,
  });

  app.put('/admin/settings/switches/:key', { schema: { params: switchParams, body: switchBody } }, async (request, reply) => {
    const { key } = request.params;
    const { on } = request.body;
    await setSwitch(app.prisma, actor(request), key, on, request.body.reason ?? 'Turned back on');
    app.settings.clear();
    if (key === 'reading') {
      // The setting is the source of truth: a queue that cannot be reached is logged, the change
      // stands, and the worker follows the setting.
      try {
        if (on) await app.ingestQueue.resume();
        else await app.ingestQueue.pause();
      } catch (err) {
        request.log.error({ err }, 'could not pause or resume the ingest queue');
      }
    }
    return reply.status(204).send();
  });

  app.put('/admin/settings/limits', { schema: { body: limitsBody } }, async (request, reply) => {
    await setLimits(app.prisma, actor(request), request.body);
    app.settings.clear();
    return reply.status(204).send();
  });

  app.put('/admin/settings/banner', { schema: { body: bannerBody } }, async (request, reply) => {
    await setBanner(app.prisma, actor(request), request.body.text, request.body.reason);
    app.settings.clear();
    return reply.status(204).send();
  });
};
