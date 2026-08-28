import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

// A handle that can never exist, so these tests never touch or depend on
// seeded fixture data -- they only need the request to reach the route
// handler and come back out, whichever Postgres `app.prisma` is pointed at.
const MISSING_HANDLE = 'this-handle-is-not-a-real-page-zzz';
const ORIGIN = 'http://localhost:3000'; // matches APP_URL in .env / .env.example

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('responds 200 with the expected shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('CORS on the chat SSE route', () => {
  // This is the assertion that must fail against the old `reply.raw.writeHead`
  // implementation: @fastify/cors sets Access-Control-Allow-Origin via
  // reply.header() in an onRequest hook, into Fastify's internal header store.
  // writeHead() bypasses that store entirely, so the header the browser needs
  // to accept the response is silently dropped from every POST /chat/:handle
  // response -- the preflight OPTIONS request is unaffected because cors
  // answers that one on its own send path.
  it('reflects the request origin and carries the SSE headers on POST /chat/:handle', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${MISSING_HANDLE}`,
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { question: 'What time do you open?' },
    });

    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['connection']).toBe('keep-alive');
  });

  it('answers a CORS preflight OPTIONS request for the same route', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: `/chat/${MISSING_HANDLE}`,
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });
});
