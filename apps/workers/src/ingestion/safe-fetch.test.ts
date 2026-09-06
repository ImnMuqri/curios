import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedAddressError } from '@curios/core';
import { createGuardedAgent, fetchGuarded, MAX_RESPONSE_BYTES } from './safe-fetch.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/**
 * Resolution that answers loopback for any name, including one that does not
 * exist. Real DNS would give shop.invalid an NXDOMAIN, so a request to it that
 * lands on the local server can only have used this answer -- which is the
 * pinning claim, stated as an experiment rather than a comment.
 */
const pinnedToLoopback = async () => [{ address: '127.0.0.1', family: 4 }];

describe('createGuardedAgent', () => {
  it('dials the address the guard returned, not one it resolved again', async () => {
    // The whole point of pinning, asserted end to end: the hostname is one that
    // does not exist, resolution is entirely ours, and the request still lands.
    const port = await serve((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<title>ok</title><p>host was ${req.headers.host}</p>`);
    });
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });

    const html = await fetchGuarded(`http://shop.invalid:${port}/`, { agent });

    expect(html).toContain(`host was shop.invalid:${port}`);
    await agent.close();
  });

  it('refuses to connect when the answer contains a private address', async () => {
    // allowPrivate is false and 127.0.0.1 is where the server is, so this must
    // fail even though the server is listening and would answer.
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const agent = createGuardedAgent({ allowPrivate: false });

    await expect(fetchGuarded(`http://localhost:${port}/`, { agent })).rejects.toThrow();
    await agent.close();
  });

  it('reports a refusal to the caller for the log', async () => {
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const onBlocked = vi.fn();
    const agent = createGuardedAgent({ allowPrivate: false, onBlocked });

    await expect(fetchGuarded(`http://localhost:${port}/`, { agent })).rejects.toThrow();
    expect(onBlocked).toHaveBeenCalledWith('localhost', expect.stringMatching(/127\.0\.0\.1|::1/));
    await agent.close();
  });
});

describe('fetchGuarded', () => {
  it('refuses a blocked literal without opening a socket', async () => {
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });
    await expect(
      fetchGuarded('http://169.254.169.254/latest/meta-data/', { agent }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    await agent.close();
  });

  it('follows a redirect and returns the destination', async () => {
    const port = await serve((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/end' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>arrived</title>');
    });
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });

    expect(await fetchGuarded(`http://shop.invalid:${port}/start`, { agent })).toContain('arrived');
    await agent.close();
  });

  it('refuses a redirect that leaves for a blocked address', async () => {
    // The hop that walks off the public internet after a check has already
    // passed. This is why automatic redirect following is given up.
    const port = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent })).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    await agent.close();
  });

  it('gives up on a redirect loop rather than following it forever', async () => {
    let hops = 0;
    const port = await serve((_req, res) => {
      hops += 1;
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent })).rejects.toThrow(
      /redirect/i,
    );
    expect(hops).toBeLessThanOrEqual(6); // the first request plus MAX_HOPS
    await agent.close();
  });

  it('stops reading a body that will not stop arriving', async () => {
    // Without a cap this test never finishes, which is the failure mode in
    // production too: a worker slot held until the deadline.
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      const chunk = 'x'.repeat(64 * 1024);
      const pump = () => {
        while (res.write(chunk)) {
          /* keep going until the socket pushes back */
        }
      };
      res.on('drain', pump);
      pump();
    });
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent })).rejects.toThrow(
      /too large/i,
    );
    await agent.close();
  }, 20_000);

  it('returns a body that fits', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>small</title>');
    });
    const agent = createGuardedAgent({ allowPrivate: true, resolve: pinnedToLoopback });

    expect(await fetchGuarded(`http://shop.invalid:${port}/`, { agent })).toBe(
      '<title>small</title>',
    );
    expect(MAX_RESPONSE_BYTES).toBe(2_000_000);
    await agent.close();
  });

  it('throws without naming the resolved address, because the owner reads this', async () => {
    // extract.service.ts writes error.message into Ingestion.error and
    // GET /ingest/:id returns it. Pinned here because improving an error
    // message is exactly how this gets broken later.
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const agent = createGuardedAgent({ allowPrivate: false });

    // try/catch rather than a matcher: an assertion about what a message does
    // NOT contain passes trivially if nothing throws, so the unreachable guard
    // is doing real work here.
    try {
      await fetchGuarded(`http://localhost:${port}/`, { agent });
      expect.unreachable('should have refused');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('127.0.0.1');
      expect(message).not.toContain('::1');
    } finally {
      await agent.close();
    }
  });
});
