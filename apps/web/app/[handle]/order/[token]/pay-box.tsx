'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShopCopy } from '../../shop/copy.js';
import styles from './order.module.css';

/** "Copied" for a moment after a copy, as the board's buttons do. */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function copyText(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // No clipboard: the text is on the screen to read.
      });
  }
  return [copied, copyText];
}

/**
 * The board's download button on the QR's corner: a tick for a moment once
 * pressed. A plain download link to this app's own address (./qr), which
 * serves the QR as an attachment: a `download` attribute is ignored across
 * origins, and storage's own address is another origin.
 */
function SaveQr(props: { href: string; copy: ShopCopy }) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function pressed() {
    clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), 1600);
  }

  return (
    <a
      href={props.href}
      download
      className={styles.save}
      data-saved={saved || undefined}
      aria-label={props.copy.saveQr}
      title={props.copy.saveQrTitle}
      onClick={pressed}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={saved ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 4v12M7 11l5 5 5-5M5 20h14'} />
      </svg>
    </a>
  );
}

export interface PayBoxProps {
  /** The shop's name, for the QR's label. */
  name: string;
  qrUrl: string | null;
  bank: { name: string | null; accountName: string | null; accountNumber: string | null };
  copy: ShopCopy;
  /** Where the QR saves from; left out, the QR has no save button (the Store preview). */
  saveHref?: string;
  /** The Store editor's picture: Save QR is a drawing, not a link, and Copy copies nothing. */
  preview?: boolean;
}

/** Whether the shop has a bank account to show. */
export function hasBank(bank: PayBoxProps['bank']): boolean {
  return Boolean(bank.name || bank.accountName || bank.accountNumber);
}

/**
 * How to pay, as the order page draws it: the owner's QR and, beside it, the
 * bank account to transfer to. The order page and the Store editor's preview
 * of it both draw this one, so the two cannot disagree. Draws nothing when the
 * shop has neither; each caller says that in its own words.
 */
export function PayBox(props: PayBoxProps) {
  const { bank, copy } = props;
  const [accountCopied, copyAccount] = useCopied();
  const bankLine = [bank.name, bank.accountName].filter(Boolean).join(' · ');
  const withBank = hasBank(bank);
  if (!props.qrUrl && !withBank) return null;
  const lead = props.qrUrl ? (withBank ? copy.scanOrTransfer : copy.scanOnly) : copy.transferTo;

  return (
    <div className={styles.payBox}>
      {props.qrUrl ? (
        <span className={styles.qr}>
          <img src={props.qrUrl} alt={copy.qrLabel(props.name)} width={104} height={104} referrerPolicy="no-referrer" />
          {props.preview ? (
            <span className={styles.save} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
              </svg>
            </span>
          ) : props.saveHref ? (
            <SaveQr href={props.saveHref} copy={copy} />
          ) : null}
        </span>
      ) : null}
      <span className={styles.bank}>
        <span>{lead}</span>
        {bankLine ? <b>{bankLine}</b> : null}
        {bank.accountNumber ? (
          <span className={styles.account}>
            <code>{bank.accountNumber}</code>
            <button type="button" className={styles.textButton} onClick={props.preview ? undefined : () => copyAccount(bank.accountNumber ?? '')}>
              {accountCopied ? copy.copied : copy.copy}
            </button>
          </span>
        ) : null}
      </span>
    </div>
  );
}
