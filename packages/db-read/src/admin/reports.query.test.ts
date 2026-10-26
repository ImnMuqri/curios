import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listReportGroups } from './reports.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Wednesday 2026-10-21, 10:00 in Malaysia. Malaysia midnight today is 2026-10-20T16:00Z.
const NOW = new Date('2026-10-21T02:00:00.000Z');
const MIDNIGHT = new Date('2026-10-20T16:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;

const ids: Record<string, string> = {};
let adminId = '';

async function aPage(key: string): Promise<string> {
  const handle = `rp-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: key } } },
    select: { pages: { select: { id: true } } },
  });
  ids[key] = account.pages[0]!.id;
  return ids[key];
}

type Reason = 'SCAM' | 'IMPERSONATION' | 'WRONG_PRICES' | 'OFFENSIVE' | 'OTHER';
const report = (key: string, reason: Reason, createdAt: Date, extra: Record<string, unknown> = {}) =>
  write.report.create({ data: { pageId: ids[key]!, reason, reporterIpHash: 'h', createdAt, ...extra } as never });
const decided = (status: 'DISMISSED' | 'ACTED', decidedAt: Date) => ({ status, decidedAt, decidedById: adminId });
const audit = (key: string, action: string, createdAt: Date) =>
  write.adminAction.create({
    data: { adminUserId: adminId, action, targetType: 'Page', targetId: ids[key]!, targetLabel: key, reason: 'r', ip: '1', createdAt },
  });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  adminId = (await write.adminUser.create({ data: { email: `r-${randomUUID()}@curios.test`, name: 'Reports Admin', passwordHash: 'x' } })).id;

  // Open: three reports, two today and one three days ago; SCAM twice, IMPERSONATION once.
  await aPage('Busy');
  await report('Busy', 'SCAM', new Date(MIDNIGHT.getTime() + HOUR), { details: 'older words' });
  await report('Busy', 'IMPERSONATION', new Date(MIDNIGHT.getTime() + 2 * HOUR), { details: 'newest words' });
  await report('Busy', 'SCAM', new Date(NOW.getTime() - 3 * DAY));
  // One second before Malaysia midnight is yesterday.
  await aPage('Edge');
  await report('Edge', 'OTHER', new Date(MIDNIGHT.getTime() - 1000));
  await report('Edge', 'OTHER', MIDNIGHT);
  // A tie between two reasons goes to the newest report's.
  await aPage('Tie');
  await report('Tie', 'OFFENSIVE', new Date(NOW.getTime() - 2 * DAY));
  await report('Tie', 'WRONG_PRICES', new Date(NOW.getTime() - 1 * DAY));
  // Two reports like Edge, but older, so it sorts after Edge and Tie on a count tie.
  await aPage('Quiet');
  await report('Quiet', 'OTHER', new Date(NOW.getTime() - 5 * DAY));
  await report('Quiet', 'OTHER', new Date(NOW.getTime() - 6 * DAY));

  // Closed.
  await aPage('Cleared');
  await report('Cleared', 'SCAM', new Date(NOW.getTime() - 4 * DAY), { details: 'it was fine', ...decided('DISMISSED', new Date(NOW.getTime() - 3 * DAY)) });
  await aPage('Warned');
  await report('Warned', 'IMPERSONATION', new Date(NOW.getTime() - 3 * DAY), decided('ACTED', new Date(NOW.getTime() - 2 * DAY)));
  await audit('Warned', 'EMAILED_OWNER', new Date(NOW.getTime() - 2 * DAY + 50));
  await aPage('Gone');
  await report('Gone', 'SCAM', new Date(NOW.getTime() - 2 * DAY), decided('ACTED', new Date(NOW.getTime() - 1 * DAY)));
  await audit('Gone', 'SUSPENDED_PAGE', new Date(NOW.getTime() - 1 * DAY + 50));
  await aPage('Stale');
  await report('Stale', 'SCAM', new Date(NOW.getTime() - 50 * DAY), decided('DISMISSED', new Date(NOW.getTime() - 31 * DAY)));
  // An open report and an older closed one: closed shows only what was decided.
  await aPage('Mixed');
  await report('Mixed', 'OTHER', new Date(NOW.getTime() - 1 * HOUR));
  await report('Mixed', 'OTHER', new Date(NOW.getTime() - 5 * DAY), decided('DISMISSED', new Date(NOW.getTime() - 4 * DAY)));
});

afterAll(async () => {
  // AdminAction rows hold their admin (Restrict), so they go first, then the admin.
  await write.adminAction.deleteMany({ where: { adminUserId: adminId } });
  await write.adminUser.deleteMany({ where: { id: adminId } });
  await write.$disconnect();
});

describe('listReportGroups, open', () => {
  it('has one group per page with open reports, by count then newest', async () => {
    const groups = await listReportGroups({ status: 'open', now: NOW });
    expect(groups.map((g) => [g.displayName, g.count])).toEqual([
      ['Busy', 3],
      ['Edge', 2],
      ['Tie', 2],
      ['Quiet', 2],
      ['Mixed', 1],
    ]);
  });

  it('counts today on the Malaysian clock', async () => {
    const by = Object.fromEntries((await listReportGroups({ status: 'open', now: NOW })).map((g) => [g.displayName, g]));
    expect(by.Busy!.countToday).toBe(2);
    expect(by.Edge!.countToday).toBe(1);
    expect(by.Quiet!.countToday).toBe(0);
  });

  it('picks the most common reason, a tie going to the newest report', async () => {
    const by = Object.fromEntries((await listReportGroups({ status: 'open', now: NOW })).map((g) => [g.displayName, g]));
    expect(by.Busy!.reason).toBe('SCAM');
    expect(by.Tie!.reason).toBe('WRONG_PRICES');
  });

  it('quotes the newest details, or none, and dates the newest report', async () => {
    const by = Object.fromEntries((await listReportGroups({ status: 'open', now: NOW })).map((g) => [g.displayName, g]));
    expect(by.Busy!.quote).toBe('newest words');
    expect(by.Edge!.quote).toBeNull();
    expect(by.Busy!.latestAt).toEqual(new Date(MIDNIGHT.getTime() + 2 * HOUR));
    expect(by.Busy).toMatchObject({ handle: expect.stringMatching(/^rp-/), pageId: ids.Busy, outcome: null });
  });
});

describe('listReportGroups, closed', () => {
  it('lists reports decided in the last 30 days, newest decision first', async () => {
    const groups = await listReportGroups({ status: 'closed', now: NOW });
    expect(groups.map((g) => g.displayName)).toEqual(['Gone', 'Warned', 'Cleared', 'Mixed']);
    expect(groups.find((g) => g.displayName === 'Mixed')!.count).toBe(1);
  });

  it('names the outcome from the decision and the audit row', async () => {
    const by = Object.fromEntries((await listReportGroups({ status: 'closed', now: NOW })).map((g) => [g.displayName, g]));
    expect(by.Cleared!.outcome).toBe('Dismissed');
    expect(by.Warned!.outcome).toBe('Owner emailed');
    expect(by.Gone!.outcome).toBe('Page suspended');
    expect(by.Cleared!.quote).toBe('it was fine');
  });
});
