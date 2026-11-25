import type { Metadata } from 'next';
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
import { PushDevice } from './push-device.js';
import { sourcePlace } from '../_ui/source-place.js';
import { PageHead } from '../_ui/page-head.js';
import { parseSettingsTab, SettingsTabs } from './tabs.js';
import styles from './settings.module.css';

/** The tab's name: "Curios - Settings" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'Settings' };

/**
 * The account and the page, from the design handoff's Dash board: the
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
  searchParams: Promise<{ linked?: string; error?: string; tab?: string | string[] }>;
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
  // Only a business page gets the emails and the device's buzz about orders and leads.
  const emails = business && notifications;
  // Two tabs when there is something to notify about (a business page); a personal page keeps one screen.
  const tab = emails ? parseSettingsTab(params.tab) : 'general';

  // Plain data across the boundary. The client parts build their own
  // handlers; a Server Component may not pass a function here.
  return (
    <>
      <PageHead
        kicker="Account"
        title="Settings"
        summary={emails ? 'Your address, how you sign in, and what we email you about.' : 'Your address, and how you sign in.'}
      />
      <div className={styles.wrap}>
        {banner ? (
          <p className={styles.banner} data-tone={banner.kind === 'error' ? 'error' : undefined} role={banner.kind === 'error' ? 'alert' : 'status'}>
            {banner.kind === 'linked' ? 'Google is now connected to your account.' : banner.message}
          </p>
        ) : null}

        {emails ? <SettingsTabs current={tab} /> : null}

        {/* General: Your page, Signing in, this device. Notifications: this device's buzz, Email me when. */}
        {/* An account with no page yet has no address and nothing to index. */}
        {tab === 'general' && page && publicUrl ? (
          <section aria-labelledby="page-title">
            <h2 id="page-title" className={styles.h} data-first="">
              Your page
            </h2>
            {/* The board's row: the address, what kind of page it is and whether search engines show it,
                then Copy. Its "Change" is not drawn: nothing can change an address yet (DEVIATIONS 274). */}
            <div className={styles.list}>
              <SettingRow
                title={sourcePlace(publicUrl)}
                note={
                  business
                    ? 'Business page · always shows up in search. A business page takes numbers, runs a shop and gets FAQ pages. It can’t go back to personal.'
                    : `Personal page · ${page.allowSearchIndexing ? 'shows up in search' : 'kept out of search'}. Answers questions about you. Selling something? A business page takes numbers and runs a shop.`
                }
                action={
                  <>
                    <CopyAddress url={publicUrl} />
                    {business ? null : (
                      <a className={styles.btn2} href="/app/billing">
                        See Business
                      </a>
                    )}
                  </>
                }
              />
            </div>
          </section>
        ) : null}

        {tab === 'general' ? (
          <section aria-labelledby="sign-in-title">
            <h2 id="sign-in-title" className={styles.h} data-first={page && publicUrl ? undefined : ''}>
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
            {/* A business page is always in search, which its row under Your page says; a personal one chooses. */}
            {page && !business ? <SearchIndexing mode={page.mode} allowed={page.allowSearchIndexing} /> : null}
            {/* The address signed in with: the old header line, kept here since the board's summary does not name it. */}
            <SettingRow
              title="This device"
              note={`Your page stays live while you’re signed out. Signed in as ${view.email}.`}
              action={<SignOutButton />}
            />
          </div>
          </section>
        ) : null}

        {/* The owner emails: orders, receipts, leads, a question asked 3 times and the plan ending, each a business page's. */}
        {tab === 'notifications' && emails ? (
          <>
            {/* A buzz on this phone or computer, as well as or instead of the email; each device is turned on by itself. */}
            <section aria-labelledby="device-title" className={styles.device}>
              <h2 id="device-title" className={styles.h} data-first="">
                On this device
              </h2>
              <div className={styles.list}>
                <PushDevice />
              </div>
            </section>
            <section aria-labelledby="email-title">
              <h2 id="email-title" className={styles.h}>
                Email me when
              </h2>
              <p className={styles.note} data-lead="">
                Sent to {view.email}. Everything also shows in the app and under the bell.
              </p>
              <div className={styles.list}>
                <Notify on={notifications} />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
