'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatRinggit } from '@curios/core/store';
import { pickVoucher, type VoucherTerms } from '@curios/core/vouchers';
import {
  BASKET_EVENT,
  basketMessage,
  defaultStorageKey,
  priceBasket,
  QUANTITY_MAX,
  readBasket,
  sameLine,
  whatsappOrderUrl,
  writeBasket,
  type BasketLine,
  type PricedItem,
} from './basket.js';
import { shopCopy } from './copy.js';
import styles from './basket-bar.module.css';

/**
 * "N items · RM… · Checkout", held at the foot of the page whenever the basket
 * has something, on the Links tab, the shop and the product page alike. It
 * reads the same sessionStorage basket the shelf writes and prices it against
 * the shelf as it is now, so a changed price or a taken-down item never shows
 * a number the shop no longer offers. A paused shop sends the visitor to
 * WhatsApp instead, as the shelf's own bar does.
 *
 * Tapping the count opens the basket as a sheet over the page: each line with
 * one less and one more, the total, and the same way on. It closes on a tap
 * outside it, on Escape, and by itself once the last line is taken out.
 */
export function BasketBar(props: {
  handle: string;
  displayName: string;
  language: string;
  items: PricedItem[];
  canTakeOrders: boolean;
  whatsapp: string | null;
  /** The small line under the count: a string says that, true says "Still in your basket" (the default), false says nothing. */
  note?: boolean | string;
  /**
   * The Store editor's picture of the bar: held inside the phone, always there
   * ("Basket is empty" until something is added), reading the preview's own
   * basket, and its Checkout turns the phone to the Pay screen. No sheet: it
   * would cover the dashboard, not the phone.
   */
  preview?: { storageKey: string; onCheckout: () => void };
  /** The shop's live automatic vouchers: the best one that fits comes off the total, as checkout will take it (none while paused). */
  vouchers?: VoucherTerms[];
}) {
  const copy = shopCopy(props.language);
  const key = props.preview?.storageKey ?? defaultStorageKey(props.handle);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const read = () => setBasket(readBasket(key));
    read();
    window.addEventListener(BASKET_EVENT, read);
    // Back from checkout can restore this page from memory with yesterday's basket on it.
    window.addEventListener('pageshow', read);
    return () => {
      window.removeEventListener(BASKET_EVENT, read);
      window.removeEventListener('pageshow', read);
    };
  }, [key]);

  const priced = useMemo(() => priceBasket(basket, props.items), [basket, props.items]);
  const empty = priced.lines.length === 0;
  const paused = !props.canTakeOrders;
  // A paused shop's basket goes to WhatsApp, where no voucher is honoured: it shows none.
  const deal = useMemo(() => (paused ? null : pickVoucher(props.vouchers ?? [], priced.lines)), [paused, props.vouchers, priced.lines]);
  const totalCents = priced.totalCents - (deal?.savingCents ?? 0);

  // The last line taken out closes the sheet: there is nothing left in it to show.
  useEffect(() => {
    if (open && empty) setOpen(false);
  }, [open, empty]);

  if (empty && !props.preview) return null;

  const count = priced.lines.reduce((sum, line) => sum + line.quantity, 0);
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const step = (line: BasketLine, by: number) =>
    writeBasket(
      key,
      basket.map((l) => (sameLine(l, line) ? { ...l, quantity: Math.min(QUANTITY_MAX, l.quantity + by) } : l)).filter((l) => l.quantity > 0),
    );

  const go: ReactNode = props.preview ? (
    <button type="button" className={styles.go} onClick={props.preview.onCheckout}>
      {copy.checkout}
    </button>
  ) : !paused ? (
    <a className={styles.go} href={`/${props.handle}/shop/checkout`}>
      {copy.checkout}
    </a>
  ) : props.whatsapp ? (
    <a className={styles.go} href={whatsappOrderUrl(props.whatsapp, basketMessage(props.displayName, priced, copy))} rel="noopener">
      {copy.orderOnWhatsApp}
    </a>
  ) : (
    <p className={styles.noWhatsApp}>{copy.noWhatsApp(props.displayName)}</p>
  );

  const summary = (
    <>
      {empty ? <span className={styles.empty}>{copy.basketEmpty}</span> : copy.barText(count, formatRinggit(totalCents))}
      {!empty && props.note !== false ? <small className={styles.note}>{typeof props.note === 'string' ? props.note : copy.stillInBasket}</small> : null}
    </>
  );

  return (
    <>
      <div className={styles.bar} data-preview={props.preview ? '' : undefined}>
        {paused ? <p className={styles.paused}>{copy.paused(props.displayName)}</p> : null}
        <div className={styles.row}>
          {props.preview || empty ? (
            <span className={styles.text}>{summary}</span>
          ) : (
            <button ref={opener} type="button" className={`${styles.text} ${styles.open}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
              {summary}
            </button>
          )}
          {go}
        </div>
      </div>
      {open ? (
        <BasketSheet title={copy.yourBasket} closeLabel={copy.closeBasket} onClose={close}>
          <ul className={styles.lines}>
            {priced.lines.map((line) => (
              <li key={`${line.itemId}:${line.optionId ?? ''}:${line.sessionId ?? ''}`} className={styles.line}>
                <span className={styles.what}>
                  <b>{line.name}</b>
                  <span>{`${line.optionLabel ? `${line.optionLabel} · ` : ''}${copy.each(formatRinggit(line.unitCents))}`}</span>
                </span>
                <span className={styles.stepper}>
                  {/* At one, one less takes the line out, as checkout's does. */}
                  <button type="button" aria-label={`${copy.oneLess}: ${line.name}`} onClick={() => step(line, -1)}>
                    −
                  </button>
                  <b>{line.quantity}</b>
                  <button type="button" aria-label={`${copy.oneMore}: ${line.name}`} disabled={line.quantity >= QUANTITY_MAX} onClick={() => step(line, 1)}>
                    +
                  </button>
                </span>
                <span className={styles.amount}>{formatRinggit(line.lineCents)}</span>
              </li>
            ))}
          </ul>
          {deal ? <p className={styles.voucher}>{copy.voucherApplied(deal.voucher.label, formatRinggit(deal.savingCents))}</p> : null}
          <div className={styles.sheetFoot}>
            <span className={styles.total}>
              <small>{copy.total}</small>
              {formatRinggit(totalCents)}
            </span>
            {go}
          </div>
        </BasketSheet>
      ) : null}
    </>
  );
}

/** The sheet itself: a dialog over a dimmed page, closed by a tap on the dim, Escape, or its close button. */
function BasketSheet({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);
  // The latest close, read when Escape comes: the sheet takes focus once, not on every + and −.
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    sheet.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closing.current();
    };
    // The page under it holds still while the sheet is open.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      root.style.overflow = overflow;
    };
  }, []);

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        ref={sheet}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetHead}>
          <h2 id={id}>{title}</h2>
          <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
