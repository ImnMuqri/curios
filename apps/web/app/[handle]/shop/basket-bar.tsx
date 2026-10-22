'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatRinggit } from '@curios/core/store';
import {
  BASKET_EVENT,
  basketMessage,
  defaultStorageKey,
  priceBasket,
  readBasket,
  whatsappOrderUrl,
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
 */
export function BasketBar(props: {
  handle: string;
  displayName: string;
  language: string;
  items: PricedItem[];
  canTakeOrders: boolean;
  whatsapp: string | null;
  /** The small line under the count. Default "Still in your basket"; the shop and product pages say nothing. */
  note?: boolean;
}) {
  const copy = shopCopy(props.language);
  const key = defaultStorageKey(props.handle);
  const [basket, setBasket] = useState<BasketLine[]>([]);

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
  if (priced.lines.length === 0) return null;

  const count = priced.lines.reduce((sum, line) => sum + line.quantity, 0);
  const paused = !props.canTakeOrders;

  return (
    <div className={styles.bar}>
      {paused ? <p className={styles.paused}>{copy.paused(props.displayName)}</p> : null}
      <div className={styles.row}>
        <span className={styles.text}>
          {copy.barText(count, formatRinggit(priced.totalCents))}
          {props.note !== false ? <small className={styles.note}>{copy.stillInBasket}</small> : null}
        </span>
        {!paused ? (
          <a className={styles.go} href={`/${props.handle}/shop/checkout`}>
            {copy.checkout}
          </a>
        ) : props.whatsapp ? (
          <a className={styles.go} href={whatsappOrderUrl(props.whatsapp, basketMessage(props.displayName, priced, copy))} rel="noopener">
            {copy.orderOnWhatsApp}
          </a>
        ) : (
          <p className={styles.noWhatsApp}>{copy.noWhatsApp(props.displayName)}</p>
        )}
      </div>
    </div>
  );
}
