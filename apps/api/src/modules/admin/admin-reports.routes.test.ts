import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE, MAIL_QUEUE, type MailJobData } from '@curios/core';
import { buildApp } from '../../app.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };

let app: FastifyInstance;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;
const madeAccounts: string[] = [];

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp({ admin: { mailQueue, store: null, privateFiles: null } });
  await app.ready();

  const admin = await app.prisma.adminUser.create({
    data: { email: `admin-${randomUUID()}@example.com`, name: 'Test Admin', passwordHash: await hashPassword('a-long-enough-passphrase') },
  });
  adminId = admin.id;
  cookie = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
});

afterAll(async () => {
  // AdminAction restricts deletion of its admin, so the audit rows go first (tests only).
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: adminId } });
  await app.prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.prisma.account.deleteMany({ where: { id: { in: madeAccounts } } });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

beforeEach(() => {
  mailQueue.add.mockClear();
});

async function aReportedPage(open = 3, extra: Record<string, unknown> = {}) {
  const slug = `ar-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@admin-reports.test`;
  const account = await app.prisma.account.create({
    data: {
      email,
      pages: { create: { handle: slug, skeleton: slug, displayName: 'Kek Lina', published: true, ...extra } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  madeAccounts.push(account.id);
  const id = account.pages[0]!.id;
  await app.prisma.report.createMany({
    data: Array.from({ length: open }, (_, i) => ({ pageId: id, reason: 'SCAM' as const, reporterIpHash: `h${i}` })),
  });
  return { id, handle: slug, email };
}

const call = (url: string, payload?: object, withCookie: string | null = cookie) =>
  app.inject({ method: 'POST', url, payload, cookies: withCookie ? { [ADMIN_COOKIE]: withCookie } : undefined });

const actions = (targetId: string) => app.prisma.adminAction.findMany({ where: { targetId } });
const reports = (pageId: string) => app.prisma.report.findMany({ where: { pageId } });

describe('dismiss reports', () => {
  it('closes every open report, stamps who and when, and writes one audit row', async () => {
    const page = await aReportedPage(3);
    const old = await app.prisma.report.create({
      data: { pageId: page.id, reason: 'OTHER', reporterIpHash: 'old', status: 'ACTED' },
    });
    const res = await call(`/admin/pages/${page.id}/reports/dismiss`, { reason: '  Looks fine  ' });

    expect(res.statusCode).toBe(204);
    const rows = await reports(page.id);
    const closed = rows.filter((r) => r.id !== old.id);
    expect(closed).toHaveLength(3);
    expect(closed.every((r) => r.status === 'DISMISSED' && r.decidedById === adminId && r.decidedAt)).toBe(true);
    expect(rows.find((r) => r.id === old.id)!.status).toBe('ACTED');

    const audit = await actions(page.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'DISMISSED_REPORTS',
      adminUserId: adminId,
      targetType: 'Page',
      targetLabel: page.handle,
      reason: 'Looks fine',
      metadata: { count: 3 },
    });
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('409s when nothing is open, with no second audit row', async () => {
    const page = await aReportedPage(2);
    await call(`/admin/pages/${page.id}/reports/dismiss`, { reason: 'Fine' });
    const again = await call(`/admin/pages/${page.id}/reports/dismiss`, { reason: 'Again' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NO_OPEN_REPORTS');
    expect(await actions(page.id)).toHaveLength(1);
  });
});

describe('email the owner', () => {
  it('queues one warning with the reason verbatim and closes the reports as acted on', async () => {
    const page = await aReportedPage(2);
    const res = await call(`/admin/pages/${page.id}/reports/email-owner`, { reason: 'Please fix your prices' });

    expect(res.statusCode).toBe(204);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, data] = mailQueue.add.mock.calls[0]!;
    expect(name).toBe(MAIL_QUEUE);
    expect(data.to).toBe(page.email);
    expect(data.subject).toBe('About your page on Curios');
    expect(data.text).toContain('Please fix your prices');

    const rows = await reports(page.id);
    expect(rows.every((r) => r.status === 'ACTED' && r.decidedById === adminId && r.decidedAt)).toBe(true);
    const audit = await actions(page.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'EMAILED_OWNER', reason: 'Please fix your prices', metadata: { count: 2 } });
    expect(await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).toMatchObject({ suspendedAt: null });
  });

  it('writes in Malay when the page is', async () => {
    const page = await aReportedPage(1, { language: 'ms' });
    await call(`/admin/pages/${page.id}/reports/email-owner`, { reason: 'Sila semak' });
    expect(mailQueue.add.mock.calls[0]![1].subject).toBe('Tentang halaman anda di Curios');
  });

  it('keeps the change when the mail cannot be queued', async () => {
    const page = await aReportedPage(1);
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));
    const res = await call(`/admin/pages/${page.id}/reports/email-owner`, { reason: 'Please fix' });
    expect(res.statusCode).toBe(204);
    expect((await reports(page.id))[0]!.status).toBe('ACTED');
  });

  it('409s when nothing is open: no mail, no audit row', async () => {
    const page = await aReportedPage(0);
    const res = await call(`/admin/pages/${page.id}/reports/email-owner`, { reason: 'Please fix' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_OPEN_REPORTS');
    expect(mailQueue.add).not.toHaveBeenCalled();
    expect(await actions(page.id)).toHaveLength(0);
  });
});

describe('suspending a reported page', () => {
  it('flips its open reports to acted, in the same step', async () => {
    const page = await aReportedPage(3);
    const res = await call(`/admin/pages/${page.id}/suspend`, { reason: 'Scam' });
    expect(res.statusCode).toBe(204);
    const rows = await reports(page.id);
    expect(rows.every((r) => r.status === 'ACTED' && r.decidedById === adminId && r.decidedAt)).toBe(true);
    const audit = await actions(page.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('SUSPENDED_PAGE');
  });
});

describe.each(['dismiss', 'email-owner'])('POST /admin/pages/:id/reports/%s', (name) => {
  it('401s without an admin', async () => {
    const page = await aReportedPage(1);
    const res = await call(`/admin/pages/${page.id}/reports/${name}`, { reason: 'x' }, null);
    expect(res.statusCode).toBe(401);
    expect((await reports(page.id))[0]!.status).toBe('OPEN');
  });

  it('400s without a reason', async () => {
    const page = await aReportedPage(1);
    for (const body of [{}, { reason: '   ' }, { reason: 'x'.repeat(501) }]) {
      expect((await call(`/admin/pages/${page.id}/reports/${name}`, body)).statusCode).toBe(400);
    }
    expect((await reports(page.id))[0]!.status).toBe('OPEN');
  });

  it('404s an unknown page', async () => {
    const res = await call(`/admin/pages/nope/reports/${name}`, { reason: 'x' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAGE_NOT_FOUND');
  });
});
