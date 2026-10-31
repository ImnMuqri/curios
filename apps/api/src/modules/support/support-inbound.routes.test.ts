import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SUPPORT_INBOUND_QUEUE } from '@curios/core';
import { buildApp } from '../../app.js';

const key = 'a-known-signing-key';
const secret = `whsec_${Buffer.from(key).toString('base64')}`;
const queue = { add: vi.fn<(name: string, data: { emailId: string }, opts?: object) => Promise<unknown>>() };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ supportInbound: { queue, secret } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  queue.add.mockReset();
  queue.add.mockResolvedValue({});
});

/** A delivery signed as Resend signs it, or with its headers left off. */
function deliver(payload: object, opts: { signed?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const id = 'msg_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1,${createHmac('sha256', Buffer.from(key)).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
  return app.inject({
    method: 'POST',
    url: '/support/inbound',
    headers: {
      'content-type': 'application/json',
      ...(opts.signed === false ? {} : { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature }),
    },
    payload: body,
  });
}

const received = (to: string[], emailId = 'email-1') => ({
  type: 'email.received',
  created_at: '2026-10-31T10:00:00Z',
  data: { email_id: emailId, from: 'Ada <ada@example.com>', to, cc: [], bcc: [], subject: 'Help', attachments: [] },
});

describe('POST /support/inbound', () => {
  it('refuses a request without the signature headers', async () => {
    const res = await deliver(received(['support@curios.my']), { signed: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_SIGNATURE');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses a bad signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/support/inbound',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_test',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': `v1,${Buffer.from('nope').toString('base64')}`,
      },
      payload: JSON.stringify(received(['support@curios.my'])),
    });
    expect(res.statusCode).toBe(400);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues mail to support with the email id as the job id', async () => {
    const res = await deliver(received(['support@curios.my'], 'email-42'));
    expect(res.statusCode).toBe(200);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      SUPPORT_INBOUND_QUEUE,
      { emailId: 'email-42' },
      expect.objectContaining({ jobId: 'email-42', attempts: 8, removeOnComplete: true }),
    );
  });

  it('adds again for the same delivery twice, under the same job id', async () => {
    await deliver(received(['support@curios.my'], 'email-7'));
    await deliver(received(['support@curios.my'], 'email-7'));
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls.map((call) => (call[2] as { jobId: string }).jobId)).toEqual(['email-7', 'email-7']);
  });

  it('answers 200 and queues nothing for mail to another address', async () => {
    const res = await deliver(received(['hello@curios.my']));
    expect(res.statusCode).toBe(200);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('answers 200 and queues nothing for another event type', async () => {
    const res = await deliver({ type: 'email.sent', data: { email_id: 'x' } });
    expect(res.statusCode).toBe(200);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('answers 400 for an email.received with no email id', async () => {
    const res = await deliver({ type: 'email.received', data: { to: ['support@curios.my'] } });
    expect(res.statusCode).toBe(400);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('answers 500 when the queue rejects, so Resend sends it again', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis is down'));
    const res = await deliver(received(['support@curios.my']));
    expect(res.statusCode).toBe(500);
  });
});
