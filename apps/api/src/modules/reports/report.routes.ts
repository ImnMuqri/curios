import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { REPORT_DETAILS_MAX, REPORT_REASON_KEYS } from '@curios/core';
import { reportPage } from './report.service.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export interface ReportRouteOptions {
  /** As REPORT_IP_SECRET: undefined reads the environment, tests pass one. */
  ipSecret?: string;
  /** Undefined reads NODE_ENV. */
  production?: boolean;
}

/** Outside production only, where no REPORT_IP_SECRET is set. Public, so it keys nothing worth keeping. */
export const DEV_REPORT_IP_SECRET = 'curios-dev-report-ip-secret';

/**
 * REPORT_IP_SECRET, read once at registration as PAYMENT_SECRETS_KEY is: production refuses
 * to start without it, and development falls back to a fixed value with a warning.
 */
export function resolveReportIpSecret(
  options: ReportRouteOptions,
  production: boolean,
  log: { warn: (msg: string) => void },
): string {
  const secret = options.ipSecret !== undefined ? options.ipSecret : process.env.REPORT_IP_SECRET;
  if (secret) return secret;
  if (production) throw new Error('REPORT_IP_SECRET is not set');
  log.warn('No REPORT_IP_SECRET: report addresses are hashed with a fixed development key. Production refuses to start without it.');
  return DEV_REPORT_IP_SECRET;
}

/** A visitor reporting a page. No session: a visitor has no account. */
export const reportRoutes: FastifyPluginAsyncZod<ReportRouteOptions> = async (app, options) => {
  const ipSecret = resolveReportIpSecret(options, options.production ?? process.env.NODE_ENV === 'production', app.log);
  app.post(
    '/pages/:handle/report',
    {
      schema: {
        params: z.object({ handle: z.string().min(1).max(64) }),
        body: z.object({
          reason: z.enum(REPORT_REASON_KEYS),
          details: z.string().max(REPORT_DETAILS_MAX).optional(),
        }),
        response: { 204: z.undefined(), 400: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      await reportPage(app.prisma, request.params.handle, request.ip, request.body, ipSecret);
      // Nothing about the reporter in the log: the address is the one thing we hash.
      request.log.info({ handle: request.params.handle, reason: request.body.reason }, 'page reported');
      return reply.status(204).send();
    },
  );
};
