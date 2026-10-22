'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRinggit, fromPrice, type DeliveryMode } from '@curios/core/store';
import type { ShopItem } from '@curios/db-read';
import {
  basketMessage,
  defaultStorageKey,
  priceBasket,
  readBasket,
  whatsappOrderUrl,
  writeBasket,
  type BasketLine,
} from './basket.js';
import { shopCopy, type ShopCopy } from './copy.js';
import styles from './shop.module.css';

export type ViewItem = ShopItem & { photoUrl: string | null };

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
  initialItemId: string | null;
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
   * 'inline' opens an item as a sheet inside the shop rather than as a modal
   * over the whole window: for the Store editor's phone preview, where a modal
   * would cover the editor itself. Default 'modal'.
   */
  sheet?: 'modal' | 'inline';
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
  const [openId, setOpenId] = useState<string | null>(props.items.some((i) => i.id === props.initialItemId) ? props.initialItemId : null);
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
  const open = props.items.find((item) => item.id === openId) ?? null;

  function add(line: BasketLine) {
    setBasket((current) => {
      const same = current.find((l) => l.itemId === line.itemId && l.optionId === line.optionId);
      return same
        ? current.map((l) => (l === same ? { ...l, quantity: l.quantity + line.quantity } : l))
        : [...current, line];
    });
    setOpenId(null);
  }

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
              <button type="button" className={styles.row} onClick={() => setOpenId(item.id)}>
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
                <span className={styles.plus} aria-hidden="true">+</span>
              </button>
            </li>
          );
        })}
      </ul>

      {open ? <ItemSheet key={open.id} item={open} copy={copy} inline={props.sheet === 'inline'} onAdd={add} onClose={() => setOpenId(null)} /> : null}

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
              <li key={`${line.itemId}:${line.optionId ?? ''}`}>
                <span>
                  {line.quantity} × {line.name}
                  {line.optionLabel ? ` (${line.optionLabel})` : ''} — {formatRinggit(line.lineCents)}
                </span>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => setBasket((current) => current.filter((l) => !(l.itemId === line.itemId && l.optionId === line.optionId)))}
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

export function ItemSheet({
  item,
  copy,
  inline,
  onAdd,
  onClose,
}: {
  item: ViewItem;
  copy: ShopCopy;
  inline: boolean;
  onAdd: (line: BasketLine) => void;
  onClose: () => void;
}) {
  const [optionId, setOptionId] = useState<string | null>(item.options[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    // Inline: shown in place, not in the top layer, so it stays inside whatever holds the shop.
    if (inline) {
      dialog.setAttribute('open', '');
      return;
    }
    // Opened as a modal so Escape closes it and focus stays inside. jsdom has
    // no showModal; the open attribute is the same sheet without the extras.
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);

  // No `open` attribute in the markup: showModal() throws on a dialog that is
  // already open. The parent unmounts this sheet on close, so the native close
  // event (Escape) and the Close button both end in the same idempotent
  // setOpenId(null); an unmount fires no close event, so nothing runs twice.
  return (
    <dialog ref={ref} className={styles.sheet} data-inline={inline || undefined} aria-labelledby="item-name" onClose={onClose}>
      {item.photoUrl ? <img className={styles.sheetPhoto} src={item.photoUrl} alt="" /> : null}
      <h2 id="item-name" className={styles.sheetName}>{item.name}</h2>
      {item.description ? <p className={styles.description}>{item.description}</p> : null}
      {item.options.length > 0 ? (
        <fieldset className={styles.options}>
          {item.options.map((option) => (
            <label key={option.id}>
              <input type="radio" name="option" checked={optionId === option.id} onChange={() => setOptionId(option.id)} />
              {option.label} — {formatRinggit(option.priceCents)}
            </label>
          ))}
        </fieldset>
      ) : item.priceCents !== null ? (
        <p className={styles.price}>{formatRinggit(item.priceCents)}</p>
      ) : null}
      <label className={styles.quantity}>
        {copy.quantity}
        <input type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
      </label>
      <button type="button" className={styles.add} onClick={() => onAdd({ itemId: item.id, optionId: item.options.length > 0 ? optionId : null, quantity })}>
        {copy.add}
      </button>
      <button type="button" className={styles.close} onClick={onClose}>{copy.close}</button>
    </dialog>
  );
}
