'use client';

import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import type { NavBadges } from '@curios/db-read';
import type { Alert } from '../alerts.js';
import { PeekBody } from './peek.js';
import styles from './notifications.module.css';

/**
 * What the bell lists under "Waiting on you" for each count in the nav (the calm Dash board's
 * notifications): the module's waiting work in a line, what to do about it under that, and its
 * icon on the status tag's tint (`tag`: receipts amber, questions blue, leads red, facts green).
 */
export const WAITING: {
  key: keyof NavBadges;
  href: string;
  say: (n: number) => string;
  note: string;
  icon: string;
  tag: 'wait' | 'new' | 'red' | 'ok';
  business?: true;
}[] = [
  {
    key: 'orders',
    href: '/app/orders',
    say: (n) => `${n} ${n === 1 ? 'receipt' : 'receipts'} to check`,
    note: 'Check each one and mark it paid.',
    icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4',
    tag: 'wait',
    business: true,
  },
  {
    key: 'questions',
    href: '/app/questions',
    say: (n) => `${n} new ${n === 1 ? 'question' : 'questions'}`,
    note: 'Answer once, the page uses it every time.',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01',
    tag: 'new',
  },
  { key: 'leads', href: '/app/leads', say: (n) => `${n} new ${n === 1 ? 'lead' : 'leads'}`, note: 'Reply within the day, leads go cold.', icon: 'M4 6h16v10H8l-4 4z', tag: 'red' },
  // The board's "Found in your menu page." names one source; the count covers them all (DEVIATIONS 315).
  {
    key: 'review',
    href: '/app/review',
    say: (n) => `${n} ${n === 1 ? 'fact' : 'facts'} to review`,
    note: 'Found in your sources. Nothing reaches customers until you accept it.',
    icon: 'M5 12.5l4.5 4.5L19 7.5',
    tag: 'ok',
  },
];

export type Waiting = (typeof WAITING)[number];

const glyph = (d: string, className: string | undefined) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);

/** The notifications' empty state: Peek, happy (the board's .nfe). */
function HappyPeek() {
  const clip = `nf-${useId().replace(/:/g, '')}`;
  return (
    <svg className={styles.peek} viewBox="0 0 160 150" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <ellipse cx="80" cy="84" rx="54" ry="49" />
        </clipPath>
      </defs>
      <ellipse cx="80" cy="143" rx="40" ry="4" fill="var(--line)" />
      <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
      <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
      <PeekBody clipId={clip} mouth="happy" />
    </svg>
  );
}

/**
 * The bell's notifications (the calm Dash board, .nfp): a head with Mark all as read, "Waiting on you"
 * (the nav's counts) and "Heads up" (the frame's alerts), each row a link to its screen with a dot
 * while it is new, and a line saying read is only the badge. The frame puts it in a Popover; the
 * frame's stylesheet makes that a sheet on a phone. What is new, and reading it, are the frame's.
 */
export function Notifications({
  waiting,
  alerts,
  badges,
  isNew,
  news,
  markRead,
  business,
}: {
  /** The rows of WAITING with something waiting, in order. */
  waiting: Waiting[];
  alerts: Alert[];
  badges: NavBadges;
  isNew: { waiting: (w: Waiting) => boolean; alert: (alert: Alert) => boolean };
  /** How much is new; Mark all as read shows while there is any. */
  news: number;
  markRead: () => void;
  /** A business page takes orders, so its empty line names them. */
  business: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  // Each row's place in the list, for the stagger as the panel opens.
  let row = 0;
  const order = () => ({ '--i': row++ }) as CSSProperties;
  const rowIcon = (content: ReactNode, tag?: string) => (
    <i className={styles.icon} data-tag={tag} aria-hidden="true">
      {content}
    </i>
  );
  const alertBody = (alert: Alert) => (
    <>
      {rowIcon('!')}
      <span className={styles.text}>
        <b>{alert.title}</b>
        <small>{alert.text}</small>
      </span>
    </>
  );
  // Mark all as read goes once there is nothing new, so focus moves to the first row first and
  // stays in the panel (the panel itself when no row takes focus).
  const read = () => {
    const first = root.current?.querySelector<HTMLElement>('a[href]');
    (first ?? root.current)?.focus();
    markRead();
  };
  return (
    <div ref={root} className={styles.root} tabIndex={-1}>
      <div className={styles.head}>
        <b>Notifications</b>
        {/* Read is only the badge: what still needs the owner stays listed until it is done. */}
        {news > 0 ? (
          <button type="button" className={styles.read} onClick={read}>
            Mark all as read
          </button>
        ) : null}
      </div>
      {waiting.length + alerts.length === 0 ? (
        <div className={styles.empty}>
          <HappyPeek />
          <b>Nothing needs you right now.</b>
          <small>{business ? 'New orders, questions and leads show up here.' : 'New questions and leads show up here.'}</small>
        </div>
      ) : (
        <>
          {waiting.length > 0 ? (
            <div role="group" aria-labelledby={`${id}-waiting`}>
              <p id={`${id}-waiting`} className={styles.group}>
                Waiting on you
              </p>
              {waiting.map((w) => (
                <Link key={w.key} href={w.href} className={styles.row} style={order()} data-new={isNew.waiting(w) ? '' : undefined}>
                  {rowIcon(glyph(w.icon, styles.glyph), w.tag)}
                  <span className={styles.text}>
                    <b>{w.say(badges[w.key])}</b>
                    <small>{w.note}</small>
                  </span>
                  {glyph('M9 6l6 6-6 6', styles.chevron)}
                </Link>
              ))}
            </div>
          ) : null}
          {alerts.length > 0 ? (
            <div role="group" aria-labelledby={`${id}-heads`}>
              <p id={`${id}-heads`} className={styles.group}>
                Heads up
              </p>
              {alerts.map((alert) =>
                alert.action ? (
                  <Link key={alert.id} href={alert.action.href} className={`${styles.row} ${styles.alert}`} style={order()} data-new={isNew.alert(alert) ? '' : undefined}>
                    {alertBody(alert)}
                  </Link>
                ) : (
                  // The Curios team's banner has nowhere to go, so it is the one row that is not a link.
                  <p key={alert.id} className={`${styles.row} ${styles.alert}`} style={order()} data-new={isNew.alert(alert) ? '' : undefined}>
                    {alertBody(alert)}
                  </p>
                ),
              )}
            </div>
          ) : null}
          <p className={styles.foot}>Things stay here until they’re done. Mark all as read only clears the badge.</p>
        </>
      )}
    </div>
  );
}
