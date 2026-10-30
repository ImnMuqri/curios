import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkVoucherCode } from './voucher.service.js';

/** A customer typing a code at checkout. Anonymous, with its own per-visitor and shop budget (app.ts). */
export const voucherCheckRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/store/:handle/vouchers/check',
    { schema: { params: z.object({ handle: z.string().min(1).max(64) }), body: z.object({ code: z.string().max(64) }) } },
    async (request) => ({ voucher: await checkVoucherCode(app.prisma, request.params.handle, request.body.code) }),
  );
};
