'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ADDRESS_MAX, NAME_MAX, ORDER_NOTE_MAX, openDays, orderTotals } from '@curios/core/orders';
import { formatRinggit, type DeliveryMode } from '@curios/core/store';
import type { ShopItem } from '@curios/db-read';
import { ApiError, apiFetch } from '../../../../lib/api.js';
import {
  basketMessage,
  defaultStorageKey,
  priceBasket,
  readBasket,
  whatsappOrderUrl,
  writeBasket,
  type BasketLine,
} from '../basket.js';
import { shopCopy } from '../copy.js';
import { Placed } from './placed.js';
import styles from './checkout.module.css';

type ViewItem = ShopItem & { photoUrl: string | null };
type Method = 'PICKUP' | 'DELIVERY';

/** The API's own bound on a line. */
const QUANTITY_MAX = 99;
/** About five show at phone width; the rest are a sideways scroll away. */
const DAYS_SHOWN = 14;
/** A Malaysian mobile without its 0 is nine digits at the least. */
const PHONE_MIN_DIGITS = 9;

export interface CheckoutProps {
  handle: string;
  displayName: string;
  language: string;
  items: ViewItem[];
  /** The owner's WhatsApp, for the fallback when checkout pauses under the visitor. */
  whatsapp: string | null;
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  deliveryNote: string | null;
  minNoticeDays: number;
  /** Weekdays the shop is closed, 0 = Sunday. */
  closedDays: number[];
  /** The server's clock when it rendered (ISO), so the browser draws the same day pills. */
  now: string;
}

interface PlacedOrder {
  code: string;
  token: string;
  totalCents: number;
  phone: string;
}

/** Where a refusal is said: under the field it is about, or above Place order. */
type Problem = { field: 'phone' | 'address' | 'day' | 'method' | 'form'; message: string };

/** The refusals that belong to one field. Anything else is said above Place order. */
const FIELD_OF: Record<string, Problem['field']> = {
  INVALID_PHONE: 'phone',
  ADDRESS_REQUIRED: 'address',
  ORDER_DATE: 'day',
  METHOD_OFF: 'method',
};

/** What PRICES_CHANGED sends back: the shelf and the delivery as they are now. */
interface Reload {
  items?: ShopItem[];
  delivery?: { mode: DeliveryMode; feeCents: number | null };
}

/**
 * What the visitor typed after the drawn +60, as the API expects it: a number
 * written the Malaysian way (0…, 60…, +60…) goes as typed, and one typed
 * without its 0, as the prefix invites, gets the prefix it was typed after.
 */
function phoneToSend(typed: string): string {
  const trimmed = typed.trim();
  return /^(\+|0|60)/.test(trimmed) ? trimmed : `+60${trimmed}`;
}

export function Checkout(props: CheckoutProps) {
  const copy = shopCopy(props.language);
  const key = defaultStorageKey(props.handle);
  const [items, setItems] = useState(props.items);
  // State, not props: a PRICES_CHANGED reply can bring a new fee or turn delivery off.
  const [delivery, setDelivery] = useState({ mode: props.deliveryMode, feeCents: props.deliveryFeeCents });
  const [deliveryOff, setDeliveryOff] = useState(false);
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [method, setMethod] = useState<Method | null>(
    props.pickupEnabled ? 'PICKUP' : props.deliveryMode !== 'NONE' ? 'DELIVERY' : null,
  );
  const [day, setDay] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pricesChanged, setPricesChanged] = useState(false);
  /** Checkout cannot take this basket: the shop paused, or the order is too big. WhatsApp replaces Place order. */
  const [fallback, setFallback] = useState<'paused' | 'tooLarge' | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const daysRef = useRef<HTMLDivElement>(null);
  const methodsRef = useRef<HTMLDivElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  // Place order sits at the foot of the screen; a refusal about a field far
  // above it would otherwise go unseen. Focusing the field scrolls it in.
  useEffect(() => {
    if (!problem) return;
    const target = {
      phone: phoneRef.current,
      address: addressRef.current,
      day: daysRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? daysRef.current?.querySelector('button') ?? null,
      method: methodsRef.current?.querySelector<HTMLElement>('[role="radio"]') ?? null,
      form: formErrorRef.current,
    }[problem.field];
    target?.focus();
  }, [problem]);

  // Read after mount: storage is the browser's, and the server rendered no basket.
  useEffect(() => {
    setLines(readBasket(key));
    setLoaded(true);
  }, [key]);

  function changeLines(next: BasketLine[]) {
    setLines(next);
    writeBasket(key, next);
  }

  function step(line: BasketLine, by: number) {
    const quantity = Math.min(QUANTITY_MAX, line.quantity + by);
    changeLines(
      lines
        .map((l) => (l.itemId === line.itemId && l.optionId === line.optionId ? { ...l, quantity } : l))
        // At 0 the line goes, as the board's minus at 1 does.
        .filter((l) => l.quantity > 0),
    );
  }

  const days = useMemo(
    () => openDays({ now: new Date(props.now), minNoticeDays: props.minNoticeDays, closedDays: props.closedDays }, DAYS_SHOWN),
    [props.now, props.minNoticeDays, props.closedDays],
  );
  const priced = useMemo(() => priceBasket(lines, items), [lines, items]);
  const totals = orderTotals(priced.lines, {
    method: method ?? 'PICKUP',
    mode: delivery.mode,
    feeCents: delivery.feeCents,
  });
  const flatFee = delivery.mode === 'FLAT' && delivery.feeCents ? formatRinggit(delivery.feeCents) : null;
  const deliveryPrice = delivery.mode === 'RIDER' ? copy.riderFee : (flatFee ?? copy.free);

  const canPlace =
    priced.lines.length > 0 &&
    name.trim() !== '' &&
    phone.replace(/\D/g, '').length >= PHONE_MIN_DIGITS &&
    day !== null &&
    method !== null &&
    (method !== 'DELIVERY' || address.trim() !== '') &&
    !sending;

  async function place() {
    if (!canPlace || !method || !day) return;
    const sentPhone = phoneToSend(phone);
    setSending(true);
    setProblem(null);
    setPricesChanged(false);
    setDeliveryOff(false);
    try {
      const result = await apiFetch<{ number: number; code: string; token: string; totalCents: number }>(
        `/store/${props.handle}/orders`,
        {
          method: 'POST',
          body: JSON.stringify({
            lines: priced.lines.map(({ itemId, optionId, quantity }) => ({ itemId, optionId, quantity })),
            method,
            day,
            customerName: name.trim(),
            phone: sentPhone,
            address: method === 'DELIVERY' ? address.trim() : null,
            note: note.trim() === '' ? null : note.trim(),
            // Placing the order under the line that says where the number goes is the consent, as on the lead card.
            consent: true,
            seenTotalCents: totals.totalCents,
          }),
        },
      );
      changeLines([]);
      setPlaced({ code: result.code, token: result.token, totalCents: result.totalCents, phone: sentPhone });
      top.current?.scrollIntoView?.();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setProblem({ field: 'form', message: copy.failed });
      } else if (error.code === 'PRICES_CHANGED') {
        const reload = (error.body ?? {}) as Reload;
        const shelf = reload.items;
        if (reload.delivery) {
          setDelivery(reload.delivery);
          if (reload.delivery.mode === 'NONE' && method === 'DELIVERY') {
            // Delivery went away under the visitor: pickup if the shop has it, and say so.
            setMethod(props.pickupEnabled ? 'PICKUP' : null);
            setDeliveryOff(props.pickupEnabled);
          }
        }
        if (Array.isArray(shelf)) {
          // The shelf comes back with keys, not URLs; a photo that has not changed keeps the URL it had.
          setItems(
            shelf.map((item) => {
              const before = items.find((i) => i.id === item.id && i.photoKey === item.photoKey);
              return { ...item, photoUrl: before?.photoUrl ?? null };
            }),
          );
        }
        setPricesChanged(true);
      } else if (error.code === 'ORDERS_PAUSED') {
        setFallback('paused');
      } else if (error.code === 'ORDER_TOO_LARGE') {
        setFallback('tooLarge');
      } else {
        setProblem({ field: FIELD_OF[error.code] ?? 'form', message: error.message });
      }
    } finally {
      setSending(false);
    }
  }

  if (placed) {
    return (
      <main className={`${styles.column} ${styles.placedColumn}`}>
        <div ref={top} />
        <Placed
          handle={props.handle}
          displayName={props.displayName}
          copy={copy}
          code={placed.code}
          token={placed.token}
          totalCents={placed.totalCents}
          phone={placed.phone}
        />
      </main>
    );
  }

  const shopHref = `/${props.handle}/shop`;
  const total = formatRinggit(totals.totalCents);

  return (
    <main className={styles.column}>
      <div ref={top} className={styles.top}>
        <a className={styles.back} href={shopHref} aria-label={copy.backToShop}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </a>
        <span>{props.displayName}</span>
      </div>
      <h1 className={styles.title}>{copy.checkout}</h1>

      {!loaded ? null : priced.lines.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 8h14l-1.5 11h-11zM9 8V6a3 3 0 0 1 6 0v2" />
            </svg>
          </span>
          <b>{copy.emptyBasket}</b>
          <p>{copy.emptyBasketBody}</p>
          <a className={styles.lite} href={shopHref}>
            {copy.backToShop}
          </a>
        </div>
      ) : (
        <>
          <section className={styles.section} aria-labelledby="ck-order">
            <div className={styles.head}>
              <h2 id="ck-order">{copy.yourOrder}</h2>
              <a href={shopHref}>{copy.addMore}</a>
            </div>
            {pricesChanged ? (
              <p className={styles.notice} role="status">
                {copy.pricesChanged}
              </p>
            ) : null}
            <ul className={styles.lines}>
              {priced.lines.map((line) => {
                const item = items.find((i) => i.id === line.itemId);
                return (
                  <li key={`${line.itemId}:${line.optionId ?? ''}`} className={styles.line}>
                    <span className={styles.thumb} aria-hidden="true">
                      {item?.photoUrl ? <img src={item.photoUrl} alt="" /> : line.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className={styles.what}>
                      <b>{line.name}</b>
                      <span>
                        {line.optionLabel ? `${line.optionLabel} · ` : ''}
                        {copy.each(formatRinggit(line.unitCents))}
                      </span>
                    </span>
                    <span className={styles.stepper}>
                      <button type="button" aria-label={copy.oneLess} onClick={() => step(line, -1)}>
                        −
                      </button>
                      <b>{line.quantity}</b>
                      <button
                        type="button"
                        aria-label={copy.oneMore}
                        disabled={line.quantity >= QUANTITY_MAX}
                        onClick={() => step(line, 1)}
                      >
                        +
                      </button>
                    </span>
                    <span className={styles.amount}>{formatRinggit(line.lineCents)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="ck-getting">
            <div className={styles.head}>
              <h2 id="ck-getting">{copy.gettingIt}</h2>
            </div>
            {deliveryOff ? (
              <p className={styles.notice} role="status">
                {copy.deliveryOff}
              </p>
            ) : null}
            <div
              ref={methodsRef}
              className={styles.methods}
              role="radiogroup"
              aria-label={copy.pickupOrDelivery}
              aria-describedby={problem?.field === 'method' ? 'ck-method-error' : undefined}
            >
              {props.pickupEnabled ? (
                <button type="button" role="radio" aria-checked={method === 'PICKUP'} className={styles.method} onClick={() => setMethod('PICKUP')}>
                  <i className={styles.radio} aria-hidden="true" />
                  <span className={styles.methodText}>
                    <b>{copy.pickupLabel}</b>
                    {props.pickupNote ? <span>{props.pickupNote}</span> : null}
                  </span>
                  <em>{copy.free}</em>
                </button>
              ) : null}
              {delivery.mode !== 'NONE' ? (
                <button type="button" role="radio" aria-checked={method === 'DELIVERY'} className={styles.method} onClick={() => setMethod('DELIVERY')}>
                  <i className={styles.radio} aria-hidden="true" />
                  <span className={styles.methodText}>
                    <b>{copy.deliveryLabel}</b>
                    {props.deliveryNote ? <span>{props.deliveryNote}</span> : null}
                  </span>
                  <em>{deliveryPrice}</em>
                </button>
              ) : null}
            </div>
            {problem?.field === 'method' ? (
              <p id="ck-method-error" className={styles.error}>
                {problem.message}
              </p>
            ) : null}
            {method === 'DELIVERY' ? (
              <div className={styles.field}>
                <label htmlFor="ck-address">{copy.address}</label>
                <textarea
                  ref={addressRef}
                  id="ck-address"
                  value={address}
                  maxLength={ADDRESS_MAX}
                  autoComplete="street-address"
                  placeholder={copy.addressPlaceholder}
                  aria-invalid={problem?.field === 'address' || undefined}
                  aria-describedby={problem?.field === 'address' ? 'ck-address-error' : undefined}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    if (problem?.field === 'address') setProblem(null);
                  }}
                />
                {problem?.field === 'address' ? (
                  <p id="ck-address-error" className={styles.error}>
                    {problem.message}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className={`${styles.head} ${styles.dayHead}`}>
              <h2 id="ck-day">{copy.day}</h2>
              <span>{copy.dayHint(props.minNoticeDays, props.closedDays)}</span>
            </div>
            <div
              ref={daysRef}
              className={styles.days}
              role="group"
              aria-labelledby="ck-day"
              aria-describedby={problem?.field === 'day' ? 'ck-day-error' : undefined}
            >
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.day}
                  aria-pressed={day === d}
                  onClick={() => {
                    setDay(d);
                    if (problem?.field === 'day') setProblem(null);
                  }}
                >
                  {copy.dayPill(d)}
                </button>
              ))}
            </div>
            {problem?.field === 'day' ? (
              <p id="ck-day-error" className={styles.error}>
                {problem.message}
              </p>
            ) : null}
          </section>

          <section className={styles.section} aria-labelledby="ck-details">
            <div className={styles.head}>
              <h2 id="ck-details">{copy.yourDetails}</h2>
            </div>
            <div className={styles.field}>
              <label htmlFor="ck-name">{copy.name}</label>
              <input id="ck-name" value={name} maxLength={NAME_MAX} autoComplete="name" onChange={(event) => setName(event.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="ck-phone">{copy.whatsappNumber}</label>
              <div className={styles.tel}>
                <em>+60</em>
                <input
                  ref={phoneRef}
                  id="ck-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={24}
                  value={phone}
                  aria-invalid={problem?.field === 'phone' || undefined}
                  aria-describedby={problem?.field === 'phone' ? 'ck-phone-error' : undefined}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    if (problem?.field === 'phone') setProblem(null);
                  }}
                />
              </div>
              {problem?.field === 'phone' ? (
                <p id="ck-phone-error" className={styles.error}>
                  {problem.message}
                </p>
              ) : null}
            </div>
            <div className={styles.field}>
              <label htmlFor="ck-note">
                {copy.noteFor(props.displayName)} <i>{copy.optional}</i>
              </label>
              <textarea
                id="ck-note"
                value={note}
                maxLength={ORDER_NOTE_MAX}
                placeholder={copy.notePlaceholder(props.displayName)}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </section>

          <section className={`${styles.section} ${styles.summary}`}>
            <div>
              <span>{copy.items}</span>
              <span>{formatRinggit(totals.itemsCents)}</span>
            </div>
            {method ? (
              <div>
                <span>{method === 'PICKUP' ? copy.pickupLabel : copy.deliveryLabel}</span>
                <span>{method === 'PICKUP' ? copy.free : deliveryPrice}</span>
              </div>
            ) : null}
            <div>
              <span>{method === 'DELIVERY' ? copy.deliveryOn : copy.pickupOn}</span>
              <span>{day ? copy.dayLong(day) : copy.pickADay}</span>
            </div>
            <div className={styles.total}>
              <span>{copy.total}</span>
              <span>{total}</span>
            </div>
            <p>
              {copy.payNote(props.displayName)} {copy.consent(props.displayName)}
            </p>
          </section>

          {problem?.field === 'form' ? (
            // Focused when it appears (tabIndex -1), so it is scrolled to and read out.
            <p ref={formErrorRef} className={styles.formError} role="alert" tabIndex={-1}>
              {problem.message}
            </p>
          ) : null}

          {fallback ? (
            <div className={styles.pausedBar} role="status">
              <p>{fallback === 'paused' ? copy.paused(props.displayName) : copy.tooLarge(props.displayName)}</p>
              {props.whatsapp ? (
                <a className={styles.whatsapp} href={whatsappOrderUrl(props.whatsapp, basketMessage(props.displayName, priced, copy))} rel="noopener">
                  {copy.orderOnWhatsApp}
                </a>
              ) : (
                <p>{copy.noWhatsApp(props.displayName)}</p>
              )}
            </div>
          ) : (
            <button type="button" className={styles.go} disabled={!canPlace} onClick={() => void place()}>
              {copy.placeOrder(total)}
            </button>
          )}
        </>
      )}
    </main>
  );
}
