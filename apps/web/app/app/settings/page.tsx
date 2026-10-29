import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getNotifications, getOwnerPage, getSignInMethods } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { decideSettingsBanner, decideSettingsView } from './settings.js';
import { AddPassword } from './add-password-form.js';
import { ConnectGoogle } from './connect-google.js';
import { CopyAddress } from './copy-address.js';
import { Notify } from './notify-emails.js';
import { SearchIndexing } from './search-indexing.js';
import { Done, SettingRow } from './setting-row.js';
import { SignOutButton } from '../sign-out-button.js';
import { sourcePlace } from '../_ui/source-place.js';
import { PageHead } from '../_ui/page-head.js';
import styles from './settings.module.css';

/**
 * The account and the page, from the design handoff's Settings board: the
 * page's address and kind, the ways to sign in, and signing out. Also the
 * redirect target a successful and a failed Google link both land on (C2,
 * C3).
 *
 * `searchParams` is a `Promise` in Next 15 and must be awaited.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; error?: string }>;
}) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const [methods, page, notifications] = await Promise.all([
    getSignInMethods(owner.accountId),
    getOwnerPage(owner.accountId),
    getNotifications(owner.accountId),
  ]);
  // The layout already proved the session is real, which means the account
  // it names exists -- this narrows the type rather than guarding a real path.
  if (!methods) redirect('/signin');

  const view = decideSettingsView(methods);
  const banner = decideSettingsBanner(params);
  const publicUrl = page ? `${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}` : null;

  // Plain data across the boundary. The client parts build their own
  // handlers; a Server Component may not pass a function here.
  return (
    <>
      <PageHead title="Settings" summary={<>Signed in as {view.email}</>} />
      <div className={styles.wrap}>
        {banner ? (
          <p className={styles.banner} data-tone={banner.kind === 'error' ? 'error' : undefined} role={banner.kind === 'error' ? 'alert' : 'status'}>
            {banner.kind === 'linked' ? 'Google is now connected to your account.' : banner.message}
          </p>
        ) : null}

        {/* An account with no page yet has no address and nothing to index. */}
        {page && publicUrl ? (
          <section className={styles.group} aria-labelledby="page-title">
            <h2 id="page-title">Your page</h2>
            <p>The address people visit, and what kind of page it is.</p>
            <div className={styles.card}>
              <SettingRow title="Address" note={sourcePlace(publicUrl)} action={<CopyAddress url={publicUrl} />} />
              {page.mode === 'BUSINESS' ? (
                <SettingRow
                  title="Business page"
                  note="Takes numbers, runs a shop and has FAQ pages. It can't be switched back to personal."
                  action={<Done>Business</Done>}
                />
              ) : (
                <SettingRow
                  title="Personal page"
                  note="Answers questions about you. Selling something? A business page takes numbers and runs a shop."
                  action={
                    <a className={styles.btn2} href="/app/billing">
                      See Business
                    </a>
                  }
                />
              )}
              <SearchIndexing mode={page.mode} allowed={page.allowSearchIndexing} />
            </div>
          </section>
        ) : null}

        <section className={styles.group} aria-labelledby="sign-in-title">
          <h2 id="sign-in-title">Signing in</h2>
          <p>{view.signNote}</p>
          <div className={styles.card}>
            <SettingRow
              title="Google"
              note={view.googleEmail ?? 'Not connected.'}
              action={view.showConnectGoogle ? <ConnectGoogle /> : <Done>Connected</Done>}
            />
            {view.showAddPassword ? (
              <AddPassword />
            ) : (
              <SettingRow title="Password" note="Set. To change it, use “Forgot your password?” when you sign in." action={<Done>Added</Done>} />
            )}
          </div>
        </section>

        {/* The owner emails: orders, receipts and leads, each a business page's. */}
        {page?.mode === 'BUSINESS' && notifications ? (
          <section className={styles.group} aria-labelledby="email-title">
            <h2 id="email-title">Email me when</h2>
            <p>Sent to {view.email}. Everything also shows in the app.</p>
            <div className={styles.card}>
              <Notify on={notifications} />
            </div>
          </section>
        ) : null}

        <section className={styles.group} aria-labelledby="session-title">
          <h2 id="session-title">Session</h2>
          <div className={styles.card}>
            <SettingRow title="Sign out" note="On this device. Your page stays live." action={<SignOutButton />} />
          </div>
        </section>
      </div>
    </>
  );
}
