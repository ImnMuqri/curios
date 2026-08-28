import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// A handle that can never exist. Requests to it still reach the route and
// consume a rate-limit token, but PageNotFoundError fires before the gateway
// is ever called -- so these tests spend no model tokens.
const MISSING_HANDLE = 'this-handle-is-not-a-real-page-zzz';

// Every run gets its own Redis key namespace. The real windows are an hour or
// a day, so without this a second run inside the window would start already
// exhausted, and tests that pass once would fail forever after.
const NAMESPACE = `curios-rl-test-${randomUUID()}:`;

let app: FastifyInstance;

beforeAll(async () => {
  process.env.RATE_LIMIT_NAMESPACE = NAMESPACE;
  // Deliberately far apart so every assertion below has exactly one possible
  // explanation: a test that trips the page limit must be nowhere near the IP
  // limit, and vice versa.
  process.env.RATE_LIMIT_CHAT_PER_PAGE = '2';
  process.env.RATE_LIMIT_CHAT_PER_IP = '5';
  process.env.RATE_LIMIT_INGEST_PER_IP = '3';
  process.env.RATE_LIMIT_INGEST_PER_PAGE = '2';

  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const chat = (ip: string, handle = MISSING_HANDLE) =>
  app.inject({
    method: 'POST',
    url: `/chat/${handle}`,
    remoteAddress: ip,
    headers: { 'content-type': 'application/json' },
    payload: { question: 'berapa harga' },
  });

describe('chat rate limit', () => {
  it('rejects a visitor who exhausts the budget for one page', async () => {
    const ip = '203.0.113.10';

    expect((await chat(ip)).statusCode).toBe(200);
    expect((await chat(ip)).statusCode).toBe(200);

    // Third request on the same page. The IP has spent only 3 of 5, so the
    // page budget is the only thing that can reject this.
    expect((await chat(ip)).statusCode).toBe(429);
  });

  it('rejects a visitor spraying across many pages, even though no single page is exhausted', async () => {
    const ip = '203.0.113.20';

    // Six different handles: each page bucket sees exactly one request and
    // never approaches its budget of 2, so only the per-IP budget of 5 can
    // explain a rejection.
    const codes: number[] = [];
    for (const handle of ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']) {
      codes.push((await chat(ip, `${MISSING_HANDLE}-${handle}`)).statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes[5]).toBe(429);
  });

  it('does not let one page exhaust another page for the same visitor', async () => {
    const ip = '203.0.113.30';

    expect((await chat(ip, `${MISSING_HANDLE}-one`)).statusCode).toBe(200);
    expect((await chat(ip, `${MISSING_HANDLE}-one`)).statusCode).toBe(200);
    expect((await chat(ip, `${MISSING_HANDLE}-one`)).statusCode).toBe(429);

    // A different page, same visitor: its own budget, untouched.
    expect((await chat(ip, `${MISSING_HANDLE}-two`)).statusCode).toBe(200);
  });

  it('does not rate limit a different visitor', async () => {
    const exhausted = '203.0.113.40';
    expect((await chat(exhausted)).statusCode).toBe(200);
    expect((await chat(exhausted)).statusCode).toBe(200);
    expect((await chat(exhausted)).statusCode).toBe(429);

    expect((await chat('203.0.113.41')).statusCode).toBe(200);
  });
});

// A syntactically valid body whose URL is rejected by the service before it
// writes anything or queues any work. The request still passes through both
// ingest limiters, so it costs a token without costing an Opus call.
const ingest = (ip: string, pageId: string) =>
  app.inject({
    method: 'POST',
    url: '/ingest',
    remoteAddress: ip,
    headers: { 'content-type': 'application/json' },
    payload: { pageId, sourceUrl: 'not-a-url' },
  });

describe('ingest rate limit', () => {
  it('rejects one caller who keeps starting ingestions, whatever page they name', async () => {
    const ip = '198.51.100.10';

    const codes: number[] = [];
    for (const page of ['p1', 'p2', 'p3', 'p4']) {
      codes.push((await ingest(ip, `${page}-${randomUUID()}`)).statusCode);
    }

    // Every page is distinct, so the per-page budget of 2 is never touched;
    // only the per-IP budget of 3 can explain the last rejection.
    expect(codes.slice(0, 3).every((code) => code !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
  });

  it('rejects repeated ingestion of one page even when the callers differ', async () => {
    const pageId = `shared-page-${randomUUID()}`;

    // Three different addresses, so no per-IP budget is near its limit of 3.
    const first = await ingest('198.51.100.21', pageId);
    const second = await ingest('198.51.100.22', pageId);
    const third = await ingest('198.51.100.23', pageId);

    expect(first.statusCode).not.toBe(429);
    expect(second.statusCode).not.toBe(429);
    expect(third.statusCode).toBe(429);
  });
});

describe('the rejection itself', () => {
  it('carries the CORS header, so the browser can read it instead of reporting a network error', async () => {
    const ip = '203.0.113.50';
    await chat(ip);
    await chat(ip);
    const blocked = await app.inject({
      method: 'POST',
      url: `/chat/${MISSING_HANDLE}`,
      remoteAddress: ip,
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      payload: { question: 'berapa harga' },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json().error).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('when Redis fails while the app is running', () => {
  it('refuses the request rather than letting it through unmetered', async () => {
    const { buildApp } = await import('../app.js');
    const ownApp = await buildApp();
    await ownApp.ready();

    try {
      // Model the realistic outage: the app booted fine and Redis went away
      // underneath it. Dropping the connection makes every limiter call fail
      // the way a real outage would.
      ownApp.rateLimitRedis.disconnect();

      const res = await ownApp.inject({
        method: 'POST',
        url: `/chat/${MISSING_HANDLE}`,
        remoteAddress: '203.0.113.99',
        headers: { 'content-type': 'application/json' },
        payload: { question: 'berapa harga' },
      });

      // The limiter is a spending control. If it cannot do its job the
      // request must not proceed: an outage is exactly when an unmetered
      // paid endpoint is most worth abusing. The plugin's own default would
      // let this through.
      expect(res.statusCode).not.toBe(200);
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      await ownApp.close();
    }
  });
});

describe('/health', () => {
  it('is never rate limited, so a load balancer polling it cannot take the API out of rotation', async () => {
    const ip = '203.0.113.60';
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await app.inject({ method: 'GET', url: '/health', remoteAddress: ip })).statusCode);
    }
    expect(codes.every((code) => code === 200)).toBe(true);
  });
});
