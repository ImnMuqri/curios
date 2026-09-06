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
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate, resolve: pinnedToLoopback });

    const html = await fetchGuarded(`http://shop.invalid:${port}/`, { agent, allowPrivate });

    expect(html).toContain(`host was shop.invalid:${port}`);
    await agent.close();
  });

  it('refuses to connect when the answer contains a private address', async () => {
    // allowPrivate is false and 127.0.0.1 is where the server is, so this must
    // fail even though the server is listening and would answer.
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const allowPrivate = false;
    const agent = createGuardedAgent({ allowPrivate });

    await expect(fetchGuarded(`http://localhost:${port}/`, { agent, allowPrivate })).rejects.toThrow();
    await agent.close();
  });

  it('reports a refusal to the caller for the log', async () => {
    const port = await serve((_req, res) => res.end('<title>reached</title>'));
    const onBlocked = vi.fn();
    const allowPrivate = false;
    const agent = createGuardedAgent({ allowPrivate, onBlocked });

    await expect(fetchGuarded(`http://localhost:${port}/`, { agent, allowPrivate })).rejects.toThrow();
    expect(onBlocked).toHaveBeenCalledWith('localhost', expect.stringMatching(/127\.0\.0\.1|::1/));
    await agent.close();
  });
});

describe('fetchGuarded', () => {
  it('refuses a literal address at the connector, with real resolution', async () => {
    // Real resolution, no stub: a resolver handed a literal answers with that
    // literal and never touches the network, which is exactly why literals do
    // not need judging anywhere else. The connector is the one place that
    // decides, and the one place the escape hatch applies.
    const allowPrivate = false;
    const agent = createGuardedAgent({ allowPrivate });

    await expect(
      fetchGuarded('http://169.254.169.254/latest/meta-data/', { agent, allowPrivate }),
    ).rejects.toThrow();
    await agent.close();
  });

  it('refuses a literal with the flag OFF, which the connector alone does not do', async () => {
    // THE regression. net.connect skips DNS for a literal, so the Agent's
    // lookup -- the guard -- is never called for http://127.0.0.1/. A version
    // of this module that trusted the connector for everything fetched this
    // address happily with the flag off, and every unit test still passed.
    // Caught by running it, pinned here so it cannot come back.
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>must not be reached</title>');
    });
    const allowPrivate = false;
    const agent = createGuardedAgent({ allowPrivate });

    await expect(
      fetchGuarded(`http://127.0.0.1:${port}/`, { agent, allowPrivate }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    await agent.close();
  });

  it('lets the escape hatch reach a literal, which is the whole point of it', async () => {
    // The regression this pins: judging literals before consulting the flag
    // made INGEST_ALLOW_PRIVATE_ADDRESSES refuse http://127.0.0.1:8099/ -- the
    // precise URL the manual walkthrough tells you to paste.
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>local</title>');
    });
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate });

    expect(await fetchGuarded(`http://127.0.0.1:${port}/`, { agent, allowPrivate })).toContain('local');
    await agent.close();
  });

  it('refuses a redirect to a scheme it will not fetch', async () => {
    // The URL-level half of hop checking. The address half is the connector,
    // which every hop goes through -- so a redirect to a private address is
    // refused by the same code path the test above exercises.
    const port = await serve((_req, res) => {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
    });
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate, resolve: pinnedToLoopback });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent, allowPrivate })).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
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
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate, resolve: pinnedToLoopback });

    expect(await fetchGuarded(`http://shop.invalid:${port}/start`, { agent, allowPrivate })).toContain('arrived');
    await agent.close();
  });

  it('gives up on a redirect loop rather than following it forever', async () => {
    let hops = 0;
    const port = await serve((_req, res) => {
      hops += 1;
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate, resolve: pinnedToLoopback });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent, allowPrivate })).rejects.toThrow(
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
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate, resolve: pinnedToLoopback });

    await expect(fetchGuarded(`http://shop.invalid:${port}/`, { agent, allowPrivate })).rejects.toThrow(
      /too large/i,
    );
    await agent.close();
  }, 20_000);

  it('returns a body that fits', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>small</title>');
    });
    const allowPrivate = true;
    const agent = createGuardedAgent({ allowPrivate, resolve: pinnedToLoopback });

    expect(await fetchGuarded(`http://shop.invalid:${port}/`, { agent, allowPrivate })).toBe(
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
    const allowPrivate = false;
    const agent = createGuardedAgent({ allowPrivate });

    // try/catch rather than a matcher: an assertion about what a message does
    // NOT contain passes trivially if nothing throws, so the unreachable guard
    // is doing real work here.
    try {
      await fetchGuarded(`http://localhost:${port}/`, { agent, allowPrivate });
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
