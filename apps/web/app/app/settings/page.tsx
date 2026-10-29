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
import { Done, GoogleIcon, KeyIcon, SettingRow } from './setting-row.js';
import { SignOutButton } from '../sign-out-button.js';
import { sourcePlace } from '../_ui/source-place.js';
import { PageHead } from '../_ui/page-head.js';
import { avatarUrl } from '../../../lib/avatar-url.js';
import styles from './settings.module.css';

/**
 * The account and the page, from the design handoff's Settings board: the
 * page's address and kind, the ways to sign in, signing out, and which emails
 * a business page gets. Also the
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

  const business = page?.mode === 'BUSINESS';
  // Only a business page gets the emails, so only it gets the second column.
  const emails = business && notifications;
  const initial = (page?.displayName.trim()[0] ?? view.email[0] ?? '').toUpperCase();
  const picture = page ? avatarUrl(page.avatarKey ?? null) : null;

  // Plain data across the boundary. The client parts build their own
  // handlers; a Server Component may not pass a function here.
  return (
    <>
      <PageHead
        title="Settings"
        summary={emails ? 'Your address, how you sign in, and what we email you about.' : 'Your address, and how you sign in.'}
      />
      <div className={styles.wrap}>
        {banner ? (
          <p className={styles.banner} data-tone={banner.kind === 'error' ? 'error' : undefined} role={banner.kind === 'error' ? 'alert' : 'status'}>
            {banner.kind === 'linked' ? 'Google is now connected to your account.' : banner.message}
          </p>
        ) : null}

        {/* Dashboard v2: two plain columns, the page and signing in on the
            left, the emails on the right; one column under ~940px. */}
        <div className={styles.cols} data-single={emails ? undefined : ''}>
          <div className={styles.col}>
            {/* An account with no page yet has no address and nothing to index. */}
            {page && publicUrl ? (
              <section aria-labelledby="page-title">
                {/* The board's page card: the address, what kind of page it is
                    and whether search engines show it. The board's "Change"
                    beside Copy is not drawn: nothing can change an address yet. */}
                <div className={styles.pageCard}>
                  {picture ? (
                    <img className={styles.pageAvatar} src={picture} alt="" width={52} height={52} />
                  ) : (
                    <span className={styles.pageAvatar} aria-hidden="true">
                      {initial}
                    </span>
                  )}
                  <div className={styles.pageText}>
                    <h2 id="page-title">Your page</h2>
                    <b>{sourcePlace(publicUrl)}</b>
                    <span>
                      <em data-tone={business ? undefined : 'personal'}>{business ? 'Business page' : 'Personal page'}</em>
                      {business ? 'Always shows up in search' : page.allowSearchIndexing ? 'Shows up in search' : 'Kept out of search'}
                    </span>
                  </div>
                  <span className={styles.pageActions}>
                    <CopyAddress url={publicUrl} />
                    {business ? null : (
                      <a className={styles.btn2} href="/app/billing">
                        See Business
                      </a>
                    )}
                  </span>
                </div>
                <p className={styles.note}>
                  {business
                    ? "A business page takes numbers, runs a shop and gets FAQ pages. It can't go back to personal."
                    : 'Answers questions about you. Selling something? A business page takes numbers and runs a shop.'}
                </p>
                {/* A business page is always in search, which the card says; a
                    personal one chooses, and its switch sits right under. */}
                {business ? null : (
                  <div className={styles.list}>
                    <SearchIndexing mode={page.mode} allowed={page.allowSearchIndexing} />
                  </div>
                )}
              </section>
            ) : null}

            <section aria-labelledby="sign-in-title">
              <h2 id="sign-in-title" className={styles.h}>
                Signing in
              </h2>
              <p className={styles.note} data-lead="">
                {view.signNote}
              </p>
              <div className={styles.list}>
                <SettingRow
                  title="Google"
                  icon={<GoogleIcon />}
                  note={view.googleEmail ?? 'Not connected.'}
                  action={view.showConnectGoogle ? <ConnectGoogle /> : <Done>Connected</Done>}
                />
                {view.showAddPassword ? (
                  <AddPassword />
                ) : (
                  <SettingRow
                    title="Password"
                    icon={<KeyIcon />}
                    note="Set. To change it, use “Forgot your password?” when you sign in."
                    action={<Done>Added</Done>}
                  />
                )}
              </div>
            </section>

            <section aria-labelledby="session-title">
              <h2 id="session-title" className={styles.h}>
                This device
              </h2>
              <div className={styles.list}>
                {/* The address signed in with: the old header line, kept here
                    since the board's summary no longer names it. */}
                <SettingRow
                  title="Sign out"
                  note={`Signed in as ${view.email}. Your page stays live while you're signed out.`}
                  action={<SignOutButton />}
                />
              </div>
            </section>
          </div>

          {/* The owner emails: orders, receipts and leads, each a business
              page's, and the plan ending, which has no switch. */}
          {emails ? (
            <div className={styles.col}>
              <section aria-labelledby="email-title">
                <h2 id="email-title" className={styles.h} data-first="">
                  Email me when
                </h2>
                <p className={styles.note} data-lead="">
                  Sent to {view.email}. Everything also shows in the app and under the bell.
                </p>
                <div className={styles.list}>
                  <Notify on={notifications} />
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
