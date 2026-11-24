'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizeMalaysianPhone } from '@curios/core/phone';
import { formatRinggit } from '@curios/core/store';
import { whatsappOrderUrl } from '../basket.js';
import type { ShopCopy } from '../copy.js';
import { ResultMark } from './result-mark.js';
import styles from './checkout.module.css';

/**
 * The customer's own number as wa.me wants it: digits, Malaysian 60….
 * The API accepted it, so it normalises; the bare digits are only a fallback.
 */
function waNumber(phone: string): string {
  return normalizeMalaysianPhone(phone)?.slice(1) ?? phone.replace(/\D/g, '');
}

/**
 * The placed screen (deleted Public board, `placed`). Owner decision 2: Curios sends
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
  /** A digital order's small line, under the way to pay. */
  digitalNote?: string | null;
  /** Paid online, and everything in the order is digital: "Paid. It's on its way to your email" and "Get your files". */
  paidDigital?: { what: string } | null;
  /** The order holds a code or a class seat until it is paid: says they are released after 30 minutes. */
  holds?: boolean;
  /** The order came to RM0, so it was placed paid: nothing to pay, only the order to see. */
  free?: boolean;
  /** The board's summary card: how it is got (when and where), and what it holds (a few photos and the total). */
  summary?: { how: { label: string; value: string } | null; count: number; thumbs: { name: string; url: string | null }[] } | null;
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
  const free = props.free === true;
  // Too many tries: the order page has the retry, so the link there stays even with no QR.
  const noWayToPay = !paid && !free && props.payByQr === false && props.onlineUnavailable !== 'tooMany';
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
      <ResultMark tone="ok" />
      <h1 ref={heading} className={styles.placedTitle} tabIndex={-1}>
        {paid ? (props.paidDigital ? copy.paidPlacedDigital : copy.paidPlaced) : copy.orderPlaced}
      </h1>
      <p className={styles.placedSub}>
        {free
          ? copy.freeOrderPaid
          : paid
            ? props.paidDigital
              ? copy.paidPlacedDigitalSub(total, props.paidDigital.what)
              : copy.paidPlacedSub(total, props.displayName)
            : copy.placedSub(props.displayName)}
      </p>
      {props.onlineUnavailable && !free ? (
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
      </div>

      {props.summary ? (
        <ul className={styles.sumc} aria-label={copy.items}>
          {props.summary.how ? (
            <li>
              <span>{props.summary.how.label}</span>
              <b>{props.summary.how.value}</b>
            </li>
          ) : null}
          <li>
            <span>{copy.itemCount(props.summary.count)}</span>
            <b>
              {props.summary.thumbs.length > 0 ? (
                <span className={styles.sumThumbs} aria-hidden="true">
                  {props.summary.thumbs.slice(0, 3).map((thumb, i) => (
                    <i key={i}>{thumb.url ? <img src={thumb.url} alt="" /> : thumb.name.trim().charAt(0).toUpperCase()}</i>
                  ))}
                </span>
              ) : null}
              {total}
            </b>
          </li>
        </ul>
      ) : null}

      <p className={styles.placedHint}>
        <b>{copy.keepCode}</b> {copy.askLater(props.displayName, props.code)}
      </p>

      {paid ? (
        <button type="button" className={styles.pay} onClick={props.onSeeOrder}>
          {props.paidDigital ? copy.getYour(props.paidDigital.what) : copy.seeOrder}
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
          {free ? copy.seeOrder : copy.payNow(total)}
          {arrow}
        </a>
      )}
      {(paid || free) && props.whatsapp && props.number !== undefined ? (
        <a className={styles.placedLite} href={whatsappOrderUrl(props.whatsapp, copy.whatsappOrderText(props.number, props.code))} rel="noopener">
          {copy.whatsappShop(props.displayName)}
        </a>
      ) : null}
      {props.digitalNote ? <p className={styles.digitalNote}>{props.digitalNote}</p> : null}
      {/* Nothing left to do here once it is paid: a way back to the shop (owner, 12 Nov 2026). */}
      {paid || free ? (
        <a className={styles.sendLink} href={`/${props.handle}/shop`}>
          {copy.backTo(props.displayName)}
        </a>
      ) : null}
      {props.holds && !paid && !free ? <p className={styles.digitalNote}>{copy.holdNote}</p> : null}
      {props.phone ? (
        <a className={styles.sendLink} href={`https://wa.me/${waNumber(props.phone)}?text=${encodeURIComponent(link)}`} rel="noopener">
          {copy.sendLink}
        </a>
      ) : null}
    </div>
  );
}
