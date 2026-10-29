import { getOwnerSession } from '@curios/db-read';

/**
 * Whose session this is, or null.
 *
 * Extracted from the layout so the decision can be tested without rendering a
 * Server Component. `getOwnerSession` is read-only by design -- it does NOT
 * extend the session, because `apps/web` holds a SELECT-only connection and
 * extending is a write. The API refreshes on its own requests, which is where
 * that write belongs.
 */
export async function resolveOwner(
  value: string | undefined,
): Promise<{ accountId: string; name: string | null; email: string } | null> {
  if (!value) return null;
  return getOwnerSession(value);
}
