'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { normalizeMalaysianPhone } from '@curios/core/phone';
import { formatRinggit } from '@curios/core/store';
import { whatsappOrderUrl } from '../basket.js';
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
 *
 * Paid online, it is the board's "Paid. Order placed" with "See your order",
 * drawn by the order page when the customer comes back from CHIP. When paying
 * online could not start, the order waits for the QR, and this says so; a shop
 * with no QR or bank account points at its WhatsApp instead.
 */
export function Placed(props: {
  handle: string;
  displayName: string;
  copy: ShopCopy;
  number?: number;
  code: string;
  token: string;
  totalCents: number;
  /** The number as it was sent with the order; absent on the order page, which has none to send to. */
  phone?: string;
  /** Paid online: "Paid. Order placed", and See your order calls this. */
  onSeeOrder?: () => void;
  /** Paying online could not start, or was tried too often. */
  onlineUnavailable?: 'unavailable' | 'tooMany' | null;
  /** The shop has a QR or bank account to pay by instead. */
  payByQr?: boolean;
  whatsapp?: string | null;
}) {
  const { copy } = props;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The form the visitor was on is gone; focus the heading that replaced it, so it is read out.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const path = `/${props.handle}/order/${props.token}`;
  const paid = props.onSeeOrder !== undefined;
  // Too many tries: the order page has the retry, so the link there stays even with no QR.
  const noWayToPay = !paid && props.payByQr === false && props.onlineUnavailable !== 'tooMany';
  const total = formatRinggit(props.totalCents);
  const arrow = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
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
      <h1 ref={heading} className={styles.placedTitle} tabIndex={-1}>
        {paid ? copy.paidPlaced : copy.orderPlaced}
      </h1>
      <p className={styles.placedSub}>{paid ? copy.paidPlacedSub(total, props.displayName) : copy.placedSub(props.displayName)}</p>
      {props.onlineUnavailable ? (
        <p className={styles.placedNotice} role="status">
          {props.onlineUnavailable === 'tooMany'
            ? copy.payTooManyLater
            : props.payByQr === false
              ? copy.onlineUnavailableWhatsApp(props.displayName)
              : copy.onlineUnavailable}
        </p>
      ) : null}

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

      {paid ? (
        <button type="button" className={styles.pay} onClick={props.onSeeOrder}>
          {copy.seeOrder}
          {arrow}
        </button>
      ) : noWayToPay ? (
        // No QR or bank account: the order page has nothing to pay by, so straight to the shop's WhatsApp.
        props.whatsapp && props.number !== undefined ? (
          <a className={`${styles.whatsapp} ${styles.placedWhatsapp}`} href={whatsappOrderUrl(props.whatsapp, copy.whatsappOrderText(props.number, props.code))} rel="noopener">
            {copy.whatsappAbout(props.displayName)}
          </a>
        ) : (
          <p className={styles.placedNotice}>{copy.noWhatsApp(props.displayName)}</p>
        )
      ) : (
        <a className={styles.pay} href={path}>
          {copy.payNow(total)}
          {arrow}
        </a>
      )}
      {props.phone ? (
        <a className={styles.sendLink} href={`https://wa.me/${waNumber(props.phone)}?text=${encodeURIComponent(link)}`} rel="noopener">
          {copy.sendLink}
        </a>
      ) : null}
    </div>
  );
}
