import { getAuthLink } from '@curios/db-read';
import { BadLink } from '../_system/BadLink.js';
import { Expired, Verified, Verify } from './verify-client.js';

/**
 * Email confirmation, from the System board. The link is looked at (not
 * spent) first, so each case gets its own screen:
 *
 * - usable: confirm it now ("Confirming your address…", then confirmed);
 * - the address is already confirmed: say so, whichever link it was;
 * - too old, or replaced by a newer one: "This link has expired", with a
 *   button for a fresh one;
 * - cut short or never ours: "That link doesn't work".
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <BadLink kind="verify" />;

  const link = await getAuthLink(token, 'EMAIL_VERIFICATION');
  if (link.state === 'unknown') return <BadLink kind="verify" />;

  const who = { email: link.email, name: link.name };
  if (link.verified) return <Verified {...who} />;
  if (link.state === 'usable') return <Verify token={token} {...who} />;
  return <Expired token={token} email={link.email} />;
}
