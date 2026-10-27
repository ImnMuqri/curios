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
