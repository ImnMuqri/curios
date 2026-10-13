'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRinggit, fromPrice, type DeliveryMode } from '@curios/core/store';
import type { ShopItem } from '@curios/db-read';
import { basketMessage, priceBasket, whatsappOrderUrl, type BasketLine } from './basket.js';
import { shopCopy, type ShopCopy } from './copy.js';
import styles from './shop.module.css';

type ViewItem = ShopItem & { photoUrl: string | null };

const defaultStorageKey = (handle: string) => `curios-basket:${handle}`;

/** Storage is the visitor's to edit, so each saved line is checked before anything prices or counts it. */
function isBasketLine(value: unknown): value is BasketLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.itemId === 'string' &&
    (line.optionId === null || typeof line.optionId === 'string') &&
    typeof line.quantity === 'number' &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0
  );
}

/** sessionStorage can be missing or throw (private windows, blocked storage); the basket then lives in memory only. */
function readBasket(key: string): BasketLine[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isBasketLine) : [];
  } catch {
    return [];
  }
}

function writeBasket(key: string, lines: BasketLine[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // Memory only, as above.
  }
}

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
  /** Hide the "Back" link to /handle (the landing's demo has no page to go back to). Default true. */
  showBack?: boolean;
  /** sessionStorage key for the basket. Default `curios-basket:${handle}`. */
  storageKey?: string;
  /** The order button's words when `onOrder` is given. Default the shop copy's orderOnWhatsApp. */
  orderLabel?: string;
  /** 'embedded' keeps the basket bar inside its container (sticky) instead of fixed to the viewport. Default 'page'. */
  variant?: 'page' | 'embedded';
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
      <ul className={styles.terms}>
        {props.pickupEnabled ? <li>{copy.pickup(props.pickupNote)}</li> : null}
        {props.deliveryMode !== 'NONE' ? (
          <li>{copy.delivery(props.deliveryMode === 'FLAT' && props.deliveryFeeCents ? formatRinggit(props.deliveryFeeCents) : null)}</li>
        ) : null}
        <li>{copy.notice(props.minNoticeDays)}</li>
      </ul>

      {props.items.length === 0 ? <p className={styles.empty}>{copy.empty}</p> : null}
      <ul className={styles.grid}>
        {props.items.map((item) => {
          const from = fromPrice(item);
          return (
            <li key={item.id}>
              <button type="button" className={styles.card} onClick={() => setOpenId(item.id)}>
                {item.photoUrl ? <img className={styles.photo} src={item.photoUrl} alt="" /> : <span className={styles.photo} data-empty-photo aria-hidden="true" />}
                <span className={styles.name}>{item.name}</span>
                <span className={styles.price}>
                  {from === null ? '' : item.options.length > 0 ? copy.from(formatRinggit(from)) : formatRinggit(from)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open ? <ItemSheet key={open.id} item={open} copy={copy} onAdd={add} onClose={() => setOpenId(null)} /> : null}

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
          <p className={styles.total}>{copy.basket(count, formatRinggit(priced.totalCents))}</p>
          {props.onOrder ? (
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
      ) : null}
    </section>
  );
}

function ItemSheet({
  item,
  copy,
  onAdd,
  onClose,
}: {
  item: ViewItem;
  copy: ShopCopy;
  onAdd: (line: BasketLine) => void;
  onClose: () => void;
}) {
  const [optionId, setOptionId] = useState<string | null>(item.options[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
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
    <dialog ref={ref} className={styles.sheet} aria-labelledby="item-name" onClose={onClose}>
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
