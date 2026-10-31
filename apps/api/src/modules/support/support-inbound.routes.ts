import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SUPPORT_INBOUND_QUEUE, type SupportInboundJobData } from '@curios/core';
import { isForSupport, supportAddress } from '@curios/core/support';
import { rawJson } from '../../plugins/raw-json.js';
import { signingKey, verifyResendSignature } from './resend-signature.js';

export interface SupportInboundRouteOptions {
  queue?: { add(name: string, data: SupportInboundJobData, opts?: object): Promise<unknown> };
  /** Resend's signing secret for the webhook; the environment's `RESEND_WEBHOOK_SECRET` when unset. */
  secret?: string;
}

// Only what is read: the rest of Resend's payload passes.
const addresses = z.array(z.string()).optional();
const delivery = z.object({
  type: z.string(),
  data: z
    .object({
      email_id: z.string().min(1).optional(),
      to: addresses,
      cc: addresses,
      received_for: addresses,
    })
    .passthrough()
    .optional(),
});

const header = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

const badRequest = (message: string) => ({ error: { code: 'BAD_REQUEST', message } });

/**
 * Resend's `email.received` webhook. It carries the email's id and addresses, not its
 * content: the worker fetches that. Here the signature is checked and the job queued; a
 * failure of ours is left to surface as a 500, so Resend sends the delivery again.
 */
export const supportInboundRoutes: FastifyPluginAsync<SupportInboundRouteOptions> = async (app, options) => {
  const secret = options.secret ?? process.env.RESEND_WEBHOOK_SECRET;
  // A secret that decodes to an empty or tiny key is as good as none: anyone could sign with it.
  if (!secret || !signingKey(secret)) {
    const problem = secret ? 'is not a whsec_ signing secret' : 'is not set';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`RESEND_WEBHOOK_SECRET ${problem}`);
    }
    app.log.warn(
      `RESEND_WEBHOOK_SECRET ${problem}: the support inbox webhook is off in development, so mail to ` +
        'support is not received. Production refuses to start without it.',
    );
    return;
  }

  // Resend signs the exact bytes it posts, so this reads the raw body.
  await app.register(rawJson);

  app.post('/support/inbound', async (request, reply) => {
    const verified = verifyResendSignature({
      id: header(request.headers['svix-id']),
      timestamp: header(request.headers['svix-timestamp']),
      signature: header(request.headers['svix-signature']),
      rawBody: request.rawBody ?? '',
      secret,
    });
    if (!verified) {
      request.log.warn('support inbound refused: bad or missing signature');
      return reply.status(400).send({ error: { code: 'BAD_SIGNATURE', message: 'Signature does not verify.' } });
    }

    const parsed = delivery.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(badRequest('Body is not a webhook delivery.'));
    const { type, data } = parsed.data;
    if (type !== 'email.received') return reply.send({ ok: true });

    const emailId = data?.email_id;
    if (!data || !emailId) return reply.status(400).send(badRequest('email.received without data.email_id.'));

    if (!isForSupport({ to: data.to, cc: data.cc, received_for: data.received_for }, supportAddress())) {
      // The recipients only: the subject and body are someone's private mail.
      request.log.info(
        { emailId, to: data.to ?? [], cc: data.cc ?? [], received_for: data.received_for ?? [] },
        'support mail to another address',
      );
      return reply.send({ ok: true });
    }

    const queue = options.queue ?? app.supportInboundQueue;
    // The email's id is the job's id, so a delivery Resend repeats is one job.
    await queue.add(
      SUPPORT_INBOUND_QUEUE,
      { emailId },
      {
        jobId: emailId,
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 86_400 },
      },
    );
    return reply.send({ ok: true });
  });
};
