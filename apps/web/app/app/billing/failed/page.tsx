import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { FAIL_WHAT_HAPPENED, isFailReason, type FailReason } from '@curios/core/chip-status';
import { supportAddress } from '@curios/core/support';
import { getOwnerPage, getPaymentResult } from '@curios/db-read';
import { resolveOwner } from '../../session.js';
import { receiptPrice, shortDate } from '../billing-copy.js';
import { FailedArt, ResultTop } from '../result-art.js';
import styles from '../result.module.css';

/** The reason rides in the query, which anyone can edit: only the four we send are believed. */
function reasonOf(value: string | undefined): FailReason {
  return isFailReason(value) ? value : 'unfinished';
}

/**
 * Where CHIP's return lands after a plan payment that will never complete: Peek, sad,
 * what was tried and why it stopped, and the way back into the pay sheet. Nothing was
 * charged, and the page says what the plan still covers.
 */
export default async function FailedPage({ searchParams }: { searchParams: Promise<{ payment?: string; reason?: string }> }) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const result = params.payment ? await getPaymentResult(page.id, params.payment) : null;
  // A paid payment has no failure to explain.
  if (!result || result.status === 'PAID') redirect('/app/billing');

  const covered = page.paidUntil && page.paidUntil.getTime() > Date.now() ? page.paidUntil : null;
  const retry = '/app/billing?pay=1';

  return (
    <main className={styles.pr}>
      <ResultTop />
      <div className={styles.card}>
        <FailedArt />
        <div className={styles.body}>
          <p className={styles.k} data-tone="no">
            Not charged
          </p>
          <h1>That didn’t go through.</h1>
          <p className={styles.l}>
            The bank stopped it before any money moved. Usually a timeout or a cancel.
            {covered ? (
              <>
                {' '}
                Your plan is still fine until <b>{shortDate(covered, true)}</b>.
              </>
            ) : null}
          </p>
          <dl className={styles.rc}>
            <div>
              <dt>Business, 1 {result.plan === 'ANNUAL' ? 'year' : 'month'}</dt>
              <dd>{receiptPrice(result.amountCents)}</dd>
            </div>
            {result.paidVia ? (
              <div>
                <dt>Tried with</dt>
                <dd>{result.paidVia}</dd>
              </div>
            ) : null}
            <div>
              <dt>What happened</dt>
              <dd data-tone="no">{FAIL_WHAT_HAPPENED[reasonOf(params.reason)]}</dd>
            </div>
          </dl>
          <div className={styles.bt}>
            <Link href={retry} className={styles.p}>
              Try again
            </Link>
            <Link href={retry} className={styles.s}>
              Pick another bank
            </Link>
          </div>
          <a className={styles.help} href={`mailto:${supportAddress()}`}>
            Need help? Email us
          </a>
        </div>
      </div>
    </main>
  );
}
