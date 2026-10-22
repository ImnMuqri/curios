import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { rawJson } from './raw-json.js';

describe('rawJson', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function anApp() {
    const app = Fastify();
    apps.push(app);
    await app.register(async (scope) => {
      await scope.register(rawJson);
      scope.post('/echo', async (request) => ({ raw: request.rawBody, body: request.body }));
    });
    // Outside the scope: the parser must not leak to routes that did not ask for it.
    app.post('/plain', async (request) => ({ raw: request.rawBody ?? null }));
    await app.ready();
    return app;
  }

  it('keeps the exact bytes of the body', async () => {
    const app = await anApp();
    const raw = '{ "b": 1,\n  "a":   [1, 2] }';

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ raw, body: { b: 1, a: [1, 2] } });
  });

  it('answers 400 for a body that is not JSON', async () => {
    const app = await anApp();

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{ nope',
    });

    expect(res.statusCode).toBe(400);
  });

  it('leaves the JSON parser alone outside its scope', async () => {
    const app = await anApp();

    const res = await app.inject({
      method: 'POST',
      url: '/plain',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":1}',
    });

    expect(res.json()).toEqual({ raw: null });
  });
});
