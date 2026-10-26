import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorsPlugin } from './errors.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(errorsPlugin);

  // A domain error, the kind this plugin is meant to pass through unchanged.
  app.get('/domain-error', async () => {
    const error: Error & { statusCode: number; code: string } = Object.assign(
      new Error('That address is not a website. Paste an http or https link.'),
      { statusCode: 400, code: 'INVALID_SOURCE_URL' },
    );
    throw error;
  });

  // Shaped like a raw Prisma error -- a `.code` that was never meant to be
  // client-facing, and no statusCode (so it falls through to 500).
  app.get('/prisma-error', async () => {
    const error: Error & { code: string } = Object.assign(
      new Error('Unique constraint failed on the fields: (`email`)'),
      { code: 'P2002' },
    );
    throw error;
  });

  // Fastify's own schema check, as every route with a schema has.
  app.get('/needs-amount', { schema: { querystring: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } } } }, async () => ({ ok: true }));

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('errorsPlugin', () => {
  it('passes a whitelisted domain error code through unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/domain-error' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'INVALID_SOURCE_URL',
        message: 'That address is not a website. Paste an http or https link.',
      },
    });
  });

  // The point of this test: a raw Prisma error code (P2002, P2003, ...) must
  // never reach the client. Only whitelisted domain codes are echoed back;
  // everything else -- including a code that merely looks legitimate --
  // defaults to INTERNAL_ERROR.
  it('names a request its schema refused INVALID_REQUEST, not INTERNAL_ERROR', async () => {
    const res = await app.inject({ method: 'GET', url: '/needs-amount' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_REQUEST');
  });

  it('never leaks a raw Prisma error code to the client on a 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/prisma-error' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something failed on our side. Try again.' },
    });
  });
});
