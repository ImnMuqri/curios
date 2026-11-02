import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getPaymentResult } from '@curios/db-read';
import { resolveOwner } from '../../session.js';
import { cardOffBanner, receiptPrice, shortDate } from '../billing-copy.js';
import { PaidArt, ResultTop } from '../result-art.js';
import styles from '../result.module.css';

/**
 * Where CHIP's return lands after a plan was paid: Peek jumping, what was bought and
 * until when. The API redirects here with our own payment id, and the id is looked up
 * for this owner's page only, so a hand-typed one shows nothing of anyone else's.
 *
 * `card=off` is the return route saying auto-renew was asked for and CHIP kept no card.
 * The plan is paid all the same, so it is a line of information, as it was on Billing.
 */
export default async function PaidPage({ searchParams }: { searchParams: Promise<{ payment?: string; card?: string }> }) {
  const params = await searchParams;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const result = params.payment ? await getPaymentResult(page.id, params.payment) : null;
  if (!result) redirect('/app/billing');
  // Not granted yet (the callback and the return can cross): Billing says it is confirming.
  if (result.status !== 'PAID' || !result.grantedUntil) redirect('/app/billing?payment=pending');

  const until = shortDate(result.grantedUntil, true);
  const firstName = owner.name?.trim().split(/\s+/)[0];
  // The box was ticked, but no card was kept: nothing will renew, whatever was asked.
  const renews = result.autoRenew && params.card !== 'off';
  const cardOff = result.autoRenew && params.card === 'off' ? cardOffBanner() : null;

  return (
    <main className={styles.pr}>
      <ResultTop />
      <div className={styles.card}>
        <PaidArt />
        <div className={styles.body}>
          <p className={styles.k}>Payment received</p>
          <h1>{firstName ? `Welcome to Business, ${firstName}.` : 'Welcome to Business.'}</h1>
          <p className={styles.l}>
            Your page keeps answering, taking orders and collecting numbers until <b>{until}</b>.{' '}
            {renews ? `Renews by itself on ${until}.` : 'Nothing renews by itself.'}
          </p>
          {cardOff ? <p className={styles.note}>{cardOff.text}</p> : null}
          <dl className={styles.rc}>
            <div>
              <dt>Business, 1 {result.plan === 'ANNUAL' ? 'year' : 'month'}</dt>
              <dd>{receiptPrice(result.amountCents)}</dd>
            </div>
            {result.paidVia ? (
              <div>
                <dt>Paid with</dt>
                <dd>{result.paidVia}</dd>
              </div>
            ) : null}
            {result.reference ? (
              <div>
                <dt>Reference</dt>
                <dd>{result.reference}</dd>
              </div>
            ) : null}
          </dl>
          <div className={styles.bt}>
            <Link href="/app" className={styles.p}>
              Go to dashboard
            </Link>
          </div>
          <p className={styles.mail}>CHIP emails your receipt to {owner.email}.</p>
        </div>
      </div>
    </main>
  );
}
