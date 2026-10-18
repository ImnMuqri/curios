import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hashSessionValue } from '@curios/core';
import type { AvatarStore } from '../pages/storage.js';

let app: FastifyInstance;
const lines: string[] = [];
let writeSpy: MockInstance<typeof process.stdout.write>;

beforeAll(async () => {
  // Before buildApp(), for the reason lead.logging.test.ts gives: pino only
  // writes through process.stdout once it has been tampered with.
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
  const { buildApp } = await import('../../app.js');
  const store: AvatarStore = { put: async () => undefined, remove: async () => undefined };
  app = await buildApp({ orders: { mailQueue: { add: async () => ({}) }, store } });
  await app.ready();
});

afterAll(async () => {
  writeSpy.mockRestore();
  await app.close();
});

describe("an order link's token never reaches the API log", () => {
  it('is masked in the request lines around a receipt upload', async () => {
    const slug = `ol-${randomUUID().slice(0, 8)}`;
    const account = await app.prisma.account.create({
      data: {
        email: `order-log-${randomUUID()}@example.com`,
        pages: { create: { handle: slug, skeleton: slug, displayName: 'OL Bakes', published: true, mode: 'BUSINESS', storeEnabled: true } },
      },
      select: { pages: { select: { id: true } } },
    });
    const token = `tok${randomUUID().replace(/-/g, '')}`;
    await app.prisma.order.create({
      data: {
        pageId: account.pages[0]!.id,
        number: 1,
        code: 'ABCD',
        tokenHash: hashSessionValue(token),
        customerName: 'Aisyah',
        phone: '+60123456789',
        method: 'PICKUP',
        day: new Date('2026-12-01T00:00:00Z'),
        itemsCents: 1_000,
        deliveryCents: 0,
        totalCents: 1_000,
      },
    });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: `/store/orders/${token}/receipt`,
      remoteAddress: '203.0.118.7',
      payload: { contentType: 'image/jpeg', data: jpeg },
    });
    expect(res.statusCode).toBe(200);

    const joined = lines.join('\n');
    // Prove the spy sees the request lines before trusting its silence.
    expect(joined).toContain('incoming request');
    expect(joined).toContain('request completed');
    expect(joined).toContain('/store/orders/:token/receipt');
    expect(joined).not.toContain(token);
  });
});
