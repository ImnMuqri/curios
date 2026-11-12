import { describe, expect, it } from 'vitest';
import { prismaRead } from './client.js';

// The columns the read-only role must never read, and one it must (so a revoke of the whole table
// cannot pass for the right reason). Mirrors packages/db/prisma/sql/readonly-role.sql and the
// migration that narrows the same two tables inline.
const WITHHELD = [
  { table: 'ChipWebhookEvent', hidden: 'body', visible: 'outcome' },
  { table: 'Report', hidden: 'reporterIpHash', visible: 'reason' },
  { table: 'AdminUser', hidden: 'passwordHash', visible: 'email' },
] as const;

describe('the read-only role', () => {
  it.each(WITHHELD)('cannot read $table.$hidden but can read $table.$visible', async ({ table, hidden, visible }) => {
    const [row] = await prismaRead.$queryRaw<{ hidden: boolean; visible: boolean }[]>`
      SELECT has_column_privilege(current_user, ${`"${table}"`}, ${hidden}, 'SELECT') AS hidden,
             has_column_privilege(current_user, ${`"${table}"`}, ${visible}, 'SELECT') AS visible`;
    expect(row).toEqual({ hidden: false, visible: true });
    await expect(prismaRead.$queryRawUnsafe(`SELECT "${hidden}" FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
  });
});

// The support inbox holds other people's mail. The role sees a thread's status and counts but never
// who wrote or what about, and no message or attachment at all.
describe('the read-only role and the support inbox', () => {
  const THREAD_VISIBLE = ['id', 'status', 'unread', 'accountId', 'lastMessageAt', 'createdAt'];
  const THREAD_HIDDEN = ['address', 'name', 'subject'];

  it.each(THREAD_VISIBLE)('can read SupportThread.%s', async (column) => {
    await expect(prismaRead.$queryRawUnsafe(`SELECT "${column}" FROM "SupportThread" LIMIT 1`)).resolves.toBeDefined();
  });

  it.each(THREAD_HIDDEN)('cannot read SupportThread.%s', async (column) => {
    await expect(prismaRead.$queryRawUnsafe(`SELECT "${column}" FROM "SupportThread" LIMIT 1`)).rejects.toThrow(/permission denied/i);
  });

  it.each([
    ['SupportMessage', ['id', 'threadId', 'direction', 'messageId', 'resendEmailId', 'fromAddress', 'fromName', 'toAddresses', 'subject', 'text', 'html', 'sendStatus', 'sentById', 'createdAt']],
    ['SupportAttachment', ['id', 'messageId', 'resendAttachmentId', 'fileName', 'contentType', 'sizeBytes', 'contentId', 'inline', 'storageKey']],
  ] as const)('cannot read any column of %s', async (table, columns) => {
    for (const column of columns) {
      await expect(prismaRead.$queryRawUnsafe(`SELECT "${column}" FROM "${table}" LIMIT 1`)).rejects.toThrow(/permission denied/i);
    }
  });
});

// The dashboard's Help log: the role counts questions (AI & usage) but never sees whose they were
// or what was asked; the admin's list of questions comes through the admin API.
describe('the read-only role and the Help log', () => {
  const VISIBLE = ['id', 'screen', 'via', 'entryId', 'ok', 'helped', 'sentToSupport', 'createdAt'];
  const HIDDEN = ['accountId', 'question', 'answer'];

  it.each(VISIBLE)('can read HelpQuestion.%s', async (column) => {
    await expect(prismaRead.$queryRawUnsafe(`SELECT "${column}" FROM "HelpQuestion" LIMIT 1`)).resolves.toBeDefined();
  });

  it.each(HIDDEN)('cannot read HelpQuestion.%s', async (column) => {
    await expect(prismaRead.$queryRawUnsafe(`SELECT "${column}" FROM "HelpQuestion" LIMIT 1`)).rejects.toThrow(/permission denied/i);
  });
});
