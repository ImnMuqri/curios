'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRinggit, fromPrice, type DeliveryMode } from '@curios/core/store';
import type { DigitalFacts } from '@curios/core/digital';
import type { ShopItem } from '@curios/db-read';
import {
  basketMessage,
  defaultStorageKey,
  priceBasket,
  readBasket,
  whatsappOrderUrl,
  sameLine,
  writeBasket,
  type BasketLine,
} from './basket.js';
import { shopCopy } from './copy.js';
import styles from './shop.module.css';

/** A shelf item as a view draws it; the digital facts are absent on the landing demo and the Store preview's physical items. */
export type ViewItem = ShopItem & Partial<DigitalFacts> & { photoUrl: string | null };

export function ShopView(props: {
  handle: string;
  displayName: string;
  language: string;
  items: ViewItem[];
  whatsapp: string | null;
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  minNoticeDays: number;
  /** A tapped row: the Store preview's product screen opens for it. */
  onOpenItem?: (id: string) => void;
  /** When given, replaces the WhatsApp link with a button that hands the message here (the landing's demo). */
  onOrder?: (message: string) => void;
  /** Called whenever the basket's lines change (and once on load), so a host can drop what it showed for the old basket. */
  onBasketChange?: () => void;
  /** Hide the "Back" link to /handle (the landing's demo has no page to go back to). Default true. */
  showBack?: boolean;
  /** sessionStorage key for the basket. Default `curios-basket:${handle}`. */
  storageKey?: string;
  /** The order button's words when `onOrder` is given. Default the shop copy's orderOnWhatsApp. */
  orderLabel?: string;
  /** 'embedded' keeps the basket bar inside its container (sticky) instead of fixed to the viewport. Default 'page'. */
  variant?: 'page' | 'embedded';
  /** "About your shop", above the terms. */
  description?: string | null;
  /**
   * canTakeOrders, on the public shop: true sends the basket to checkout;
   * false says checkout is paused and offers WhatsApp instead. Left out
   * (the landing's demo, the Store preview), the bar is WhatsApp as before.
   */
  canTakeOrders?: boolean;
  /**
   * The Store preview's checkout, as the Store board draws it: the bar is
   * always there ("Basket is empty" until something is added), and its
   * Checkout button calls this instead of leaving the page.
   */
  onCheckout?: () => void;
}) {
  const copy = shopCopy(props.language);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const loaded = useRef(false);
  const key = props.storageKey ?? defaultStorageKey(props.handle);

  useEffect(() => {
    setBasket(readBasket(key));
  }, [key]);
  useEffect(() => {
    if (loaded.current) writeBasket(key, basket);
  }, [key, basket]);
  // Declared after the writer on purpose: the first pass must not write the empty starting basket over what was saved.
  useEffect(() => {
    loaded.current = true;
  }, []);

  // Held in a ref so a host's fresh callback each render never re-fires the effect.
  const basketChanged = useRef(props.onBasketChange);
  basketChanged.current = props.onBasketChange;
  useEffect(() => {
    basketChanged.current?.();
  }, [basket]);

  const priced = useMemo(() => priceBasket(basket, props.items), [basket, props.items]);
  const count = priced.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <section className={styles.shop} data-variant={props.variant === 'embedded' ? 'embedded' : undefined}>
      {props.showBack !== false ? <a className={styles.back} href={`/${props.handle}`}>← {copy.back}</a> : null}
      {props.description ? <p className={styles.about}>{props.description}</p> : null}
      <ul className={styles.terms}>
        {props.pickupEnabled ? <li>{copy.pickup(props.pickupNote)}</li> : null}
        {props.deliveryMode !== 'NONE' ? (
          <li>{copy.delivery(props.deliveryMode === 'FLAT' && props.deliveryFeeCents ? formatRinggit(props.deliveryFeeCents) : null)}</li>
        ) : null}
        <li>{copy.notice(props.minNoticeDays)}</li>
      </ul>

      {props.items.length === 0 ? <p className={styles.empty}>{copy.empty}</p> : null}
      <ul className={styles.rows}>
        {props.items.map((item) => {
          const from = fromPrice(item);
          const inBasket = basket.filter((line) => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
          return (
            <li key={item.id}>
              <button type="button" className={styles.row} onClick={() => props.onOpenItem?.(item.id)}>
                <span className={styles.thumb} aria-hidden="true">
                  {item.photoUrl ? <img src={item.photoUrl} alt="" /> : item.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{item.name}</span>
                  <span className={styles.price}>
                    {from === null ? '' : item.options.length > 0 ? copy.from(formatRinggit(from)) : formatRinggit(from)}
                  </span>
                </span>
                {inBasket > 0 ? <span className={styles.count}>{inBasket}×</span> : null}
                <span className={styles.plus} aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>

      {props.onCheckout && priced.lines.length === 0 ? (
        <div className={styles.basket} data-empty="">
          <div className={styles.bar}>
            <p className={styles.total} data-empty="">
              {copy.basketEmpty}
            </p>
            <button type="button" className={styles.order} onClick={props.onCheckout}>
              {copy.checkout}
            </button>
          </div>
        </div>
      ) : null}

      {priced.lines.length > 0 ? (
        <div className={styles.basket}>
          <ul className={styles.lines}>
            {priced.lines.map((line) => (
              <li key={`${line.itemId}:${line.optionId ?? ''}:${line.sessionId ?? ''}`}>
                <span>
                  {line.quantity} × {line.name}
                  {line.optionLabel ? ` (${line.optionLabel})` : ''} — {formatRinggit(line.lineCents)}
                </span>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => setBasket((current) => current.filter((l) => !sameLine(l, line)))}
                >
                  {copy.remove}
                </button>
              </li>
            ))}
          </ul>
          {props.canTakeOrders === false && props.whatsapp && !props.onOrder ? (
            <p className={styles.paused}>{copy.paused(props.displayName)}</p>
          ) : null}
          <div className={styles.bar}>
          <p className={styles.total}>{copy.basket(count, formatRinggit(priced.totalCents))}</p>
          {props.onCheckout ? (
            <button type="button" className={styles.order} onClick={props.onCheckout}>
              {copy.checkout}
            </button>
          ) : props.canTakeOrders && !props.onOrder ? (
            <a className={styles.order} href={`/${props.handle}/shop/checkout`}>
              {copy.checkout}
            </a>
          ) : props.onOrder ? (
            <button type="button" className={styles.order} onClick={() => props.onOrder?.(basketMessage(props.displayName, priced, copy))}>
              {props.orderLabel ?? copy.orderOnWhatsApp}
            </button>
          ) : props.whatsapp ? (
            <a className={styles.order} href={whatsappOrderUrl(props.whatsapp, basketMessage(props.displayName, priced, copy))} rel="noopener">
              {copy.orderOnWhatsApp}
            </a>
          ) : (
            <p className={styles.noWhatsApp}>{copy.noWhatsApp(props.displayName)}</p>
          )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
