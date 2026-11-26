'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { usePayDialog } from './pay-context.js';
import styles from './billing.module.css';
import { Callout } from '@curios/ui';

/** The card line as plain data: this file must not import the @curios/core barrel, so the page formats it. */
export interface RenewCard {
  /** "Visa ending 4242"; null when CHIP did not say. */
  label: string | null;
  /** "RM49". */
  price: string;
  /** "14 Dec 2026": when the plan ends, or ended; null only for a page that never paid. */
  paidUntil: string | null;
  /** The last renewal was refused: the job tries again tomorrow. */
  failed: boolean;
  /**
   * The plan has run out and the job is still trying the card, for up to 3 days after:
   * the owner must still be able to stop tomorrow's charge.
   */
  ended: boolean;
}

/** A tick, or the "!" of a card that needs the owner. */
function Mark({ bad }: { bad: boolean }) {
  return (
    <span className={styles.xok} data-bad={bad || undefined} aria-hidden="true">
      {bad ? (
        '!'
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </span>
  );
}

/** The card's title and line: what auto-renew is about to do, or what just went wrong. */
function renewText(card: RenewCard): { title: string; line: string } {
  const which = card.label ?? 'your card';
  if (card.ended) {
    return {
      title: 'Auto-renew is still on',
      line: `${card.paidUntil ? `Your plan ended on ${card.paidUntil}. ` : ''}We’ll try ${which} again tomorrow.`,
    };
  }
  if (card.failed) {
    return {
      title: 'Your last renewal didn’t go through',
      line: `We’ll try ${which} again tomorrow.${card.paidUntil ? ` Your plan still runs until ${card.paidUntil}.` : ''}`,
    };
  }
  return { title: 'Auto-renew is on', line: `We’ll charge ${which} ${card.price} on ${card.paidUntil ?? 'the day your plan ends'}.` };
}

/** The question before turning it off: the plan keeps running, and then stops unless it is paid again. */
function offQuestion(card: RenewCard): string {
  if (card.ended) return 'Turn off auto-renew? We will stop trying your card.';
  return `Turn off auto-renew? Your plan still runs until ${card.paidUntil ?? 'the day it ends'}, then stops unless you pay again.`;
}

/** What replaces the card once it is off. */
function offResult(card: RenewCard): string {
  if (card.ended) return `${card.paidUntil ? `Your plan ended on ${card.paidUntil}. ` : ''}Pay again any time from here.`;
  return `${card.paidUntil ? `Your plan runs until ${card.paidUntil}. ` : ''}Pay again any time from here.`;
}

/** A 4xx carries a sentence written for the owner; anything else gets a plain one. */
function offError(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message;
  return failure instanceof Error ? failure.message : 'Something failed. Try again.';
}

/**
 * Auto-renew as the board's status card, above the plan: a tick and what the card will do, or a "!"
 * and what went wrong, with the way to pay another way when a charge failed. Turning it off asks
 * first, in place ("Turn off auto-renew? Your plan still runs until ..."), then the card says
 * "Auto-renew is off". The card stays mounted to say it: the page stops sending a card once it is off.
 * Refreshing is the caller's, so a test can watch for it.
 *
 * Presentational half of the wrapper split.
 */
export function AutoRenewCard({
  card,
  canPay,
  onPayAnother,
  onOff,
  refresh,
}: {
  /** Null once the page has no card to show (it is off, or never was). */
  card: RenewCard | null;
  /** Online payments are on: only then is there a pay dialog to open. */
  canPay: boolean;
  onPayAnother: () => void;
  onOff: () => Promise<unknown>;
  refresh: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What was on the card when it was turned off, so it can say so after the page stops sending it.
  const [off, setOff] = useState<RenewCard | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  async function turnOff() {
    if (!card) return;
    setError('');
    setBusy(true);
    try {
      await onOff();
      setOff(card);
      setAsking(false);
      // Re-reads the Server Component, so the plan line says "No auto-renew" again.
      refresh();
    } catch (failure) {
      setError(offError(failure));
    } finally {
      setBusy(false);
    }
  }

  function ask() {
    setAsking(true);
    // The way out takes focus, as the other confirms do; the render has to land first.
    setTimeout(() => keep.current?.focus(), 0);
  }

  function dismiss() {
    setAsking(false);
    setError('');
    setTimeout(() => trigger.current?.focus(), 0);
  }

  let mark = <Mark bad={false} />;
  let body: ReactNode = null;

  if (off) {
    body = (
      <>
        <b>Auto-renew is off</b>
        <p>{offResult(off)}</p>
      </>
    );
  } else if (card) {
    const { title, line } = renewText(card);
    const needsYou = card.failed || card.ended;
    mark = <Mark bad={needsYou} />;
    body = (
      <>
        <b>{title}</b>
        <p>{line}</p>
        {asking ? (
          <div className={styles.ask}>
            <p>{offQuestion(card)}</p>
            <div className={styles.xbtns}>
              <button type="button" className={styles.prim} disabled={busy} onClick={() => void turnOff()}>
                {busy ? 'Turning off…' : 'Turn off auto-renew'}
              </button>
              <button ref={keep} type="button" className={styles.btn2} disabled={busy} onClick={dismiss}>
                Keep it on
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.xbtns}>
            {needsYou && canPay ? (
              <button type="button" className={styles.prim} onClick={onPayAnother}>
                Pay another way
              </button>
            ) : null}
            <button ref={trigger} type="button" className={styles.btn2} onClick={ask}>
              {needsYou ? 'Turn off auto-renew' : 'Turn off'}
            </button>
          </div>
        )}
        {error ? (
          <div className={styles.errorRow}>
            <Callout tone="error">{error}</Callout>
          </div>
        ) : null}
      </>
    );
  }

  if (!body) return null;
  return (
    <div className={styles.xcard} data-bad={(card && (card.failed || card.ended)) || undefined}>
      {mark}
      <div className={styles.xct} aria-live="polite">
        {body}
      </div>
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass a function here. */
export function AutoRenew({ card, canPay }: { card: RenewCard | null; canPay: boolean }) {
  const router = useRouter();
  const pay = usePayDialog();
  return (
    <AutoRenewCard
      card={card}
      canPay={canPay && pay !== null}
      onPayAnother={() => pay?.setOpen(true)}
      onOff={() => apiFetch('/billing/auto-renew/off', { method: 'POST' })}
      refresh={() => router.refresh()}
    />
  );
}
