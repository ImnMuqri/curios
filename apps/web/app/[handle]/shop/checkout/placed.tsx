'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { normalizeMalaysianPhone } from '@curios/core/phone';
import { formatRinggit } from '@curios/core/store';
import type { ShopCopy } from '../copy.js';
import styles from './checkout.module.css';

/** The confetti around the check: twelve pieces, a twelfth of a turn apart. */
const BURST = Array.from({ length: 12 }, (_, i) => i);

/**
 * The customer's own number as wa.me wants it: digits, Malaysian 60….
 * The API accepted it, so it normalises; the bare digits are only a fallback.
 */
function waNumber(phone: string): string {
  return normalizeMalaysianPhone(phone)?.slice(1) ?? phone.replace(/\D/g, '');
}

/**
 * The placed screen (Public board, `placed`). Owner decision 2: Curios sends
 * no WhatsApp, so under Pay is a button that opens the customer's own chat
 * with the order link in it, rather than the board's "We also sent…".
 */
export function Placed(props: {
  handle: string;
  displayName: string;
  copy: ShopCopy;
  code: string;
  token: string;
  totalCents: number;
  /** The number as it was sent with the order. */
  phone: string;
}) {
  const { copy } = props;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The form the visitor was on is gone; focus the heading that replaced it, so it is read out.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const path = `/${props.handle}/order/${props.token}`;
  // Only ever rendered in the browser, after the order is placed.
  const link = `${window.location.origin}${path}`;

  function copyCode() {
    void navigator.clipboard
      ?.writeText(props.code)
      .then(() => {
        clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // No clipboard (an old browser, a denied permission): the code is on the screen to read.
      });
  }

  return (
    <div className={styles.placed}>
      <div className={styles.burst} aria-hidden="true">
        {BURST.map((i) => (
          <span key={i} style={{ '--a': `${i * 30}deg`, animationDelay: `${120 + (i % 3) * 40}ms` } as CSSProperties} />
        ))}
        <svg viewBox="0 0 96 96" width="96" height="96">
          <circle cx="48" cy="48" r="40" />
          <path d="M31 49l11 11 23-24" className={styles.tick} />
        </svg>
      </div>
      <h1 ref={heading} className={styles.placedTitle} tabIndex={-1}>{copy.orderPlaced}</h1>
      <p className={styles.placedSub}>{copy.placedSub(props.displayName)}</p>

      <div className={styles.codebox}>
        <small>{copy.yourCode}</small>
        <div className={styles.code} role="img" aria-label={copy.codeLabel(props.code)}>
          {props.code.split('').map((ch, i) => (
            <span key={i} style={{ animationDelay: `${250 + i * 90}ms` }}>
              {ch}
            </span>
          ))}
        </div>
        <button type="button" className={styles.copy} onClick={copyCode}>
          {copied ? copy.copied : copy.copyCode}
        </button>
        <p>
          <b>{copy.keepCode}</b> {copy.askLater(props.displayName, props.code)}
        </p>
      </div>

      <a className={styles.pay} href={path}>
        {copy.payNow(formatRinggit(props.totalCents))}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </a>
      <a className={styles.sendLink} href={`https://wa.me/${waNumber(props.phone)}?text=${encodeURIComponent(link)}`} rel="noopener">
        {copy.sendLink}
      </a>
    </div>
  );
}
