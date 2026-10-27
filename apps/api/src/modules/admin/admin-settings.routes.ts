import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BANNER_MAX, PRICE_MAX_RM } from '@curios/core';
import type { AdminActor } from './admin-pages.service.js';
import { setBanner, setLimits, setReadingSwitch, setSwitch } from './admin-settings.service.js';

const reason = z.string().trim().min(1).max(500);
const switchParams = z.object({ key: z.enum(['chat', 'signups', 'reading', 'chipPayments', 'ownerEmails']) });
const switchBody = z
  .object({ on: z.boolean(), reason: reason.optional() })
  .refine((b) => b.on || b.reason !== undefined, { message: 'Say why you are turning it off.', path: ['reason'] });
// Only the fields the admin changed are sent, at least one of them. A free allowance of 0 would stop
// a trial page at its first lead or order, so the least is 1.
const limitsBody = z
  .object({
    cap: z.number().int().min(1).max(100000).optional(),
    freeLeads: z.number().int().min(1).max(1000).optional(),
    freeOrders: z.number().int().min(1).max(1000).optional(),
    monthlyRm: z.number().int().min(1).max(PRICE_MAX_RM * 10).optional(),
    yearlyRm: z.number().int().min(1).max(PRICE_MAX_RM * 10).optional(),
    reason,
    confirmBig: z.boolean().optional(),
  })
  .refine((b) => [b.cap, b.freeLeads, b.freeOrders, b.monthlyRm, b.yearlyRm].some((v) => v !== undefined), {
    message: 'Change at least one limit or price.',
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
    const why = request.body.reason ?? 'Turned back on';
    // Reading is the paused ingest queue itself, so the queue is moved first and the setting saved
    // only once it has been (setReadingSwitch).
    if (key === 'reading') await setReadingSwitch(app.prisma, app.ingestQueue, actor(request), on, why, request.log);
    else await setSwitch(app.prisma, actor(request), key, on, why);
    app.settings.clear();
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
