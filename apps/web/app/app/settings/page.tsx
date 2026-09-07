import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getSignInMethods } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { decideSettingsBanner, decideSettingsView } from './settings.js';
import { AddPassword } from './add-password-form.js';
import { ConnectGoogle } from './connect-google.js';
import styles from './settings.module.css';

/**
 * The second way into an account, and the redirect target both a successful
 * and a failed Google link land on -- C2, C3.
 *
 * `searchParams` is a `Promise` in Next 15 and must be awaited, the pattern
 * already in `signin/page.tsx`, `verify/page.tsx` and `reset/page.tsx`.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; error?: string }>;
}) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const methods = await getSignInMethods(owner.accountId);
  // The layout already proved the session is real, which means the account
  // it names exists -- this is belt and braces for a direct render, narrowing
  // the type rather than guarding against a real path.
  if (!methods) redirect('/signin');

  const view = decideSettingsView(methods);
  const banner = decideSettingsBanner(params);

  // Plain data across the boundary -- `view` and `banner` are strings and
  // booleans, so both cross fine. `AddPassword` and `ConnectGoogle` build
  // their own handlers on the client side of the RSC boundary; a Server
  // Component may not pass a function here.
  return (
    <>
      <h2 className={styles.heading}>Settings</h2>
      <p className={styles.account}>Signed in as {view.email}.</p>

      {banner?.kind === 'linked' ? (
        <Callout tone="info">Google is now connected to your account.</Callout>
      ) : null}
      {banner?.kind === 'error' ? <Callout tone="error">{banner.message}</Callout> : null}

      {view.showAddPassword ? <AddPassword /> : null}
      {view.showConnectGoogle ? <ConnectGoogle /> : null}
      {!view.showAddPassword && !view.showConnectGoogle ? (
        // Empty states are instructions, not moods -- an account with both
        // sign-in methods must still be told something, not shown a blank
        // screen with nothing to click.
        <Callout tone="info">You can already sign in with your password or with Google.</Callout>
      ) : null}
    </>
  );
}
