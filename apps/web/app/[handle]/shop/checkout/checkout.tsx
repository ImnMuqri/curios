'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ADDRESS_MAX, NAME_MAX, ORDER_NOTE_MAX, openDays, orderTotals } from '@curios/core/orders';
import { formatRinggit, type DeliveryMode } from '@curios/core/store';
import { isDigitalOnly, type DigitalFacts } from '@curios/core/digital';
import type { ShopItem } from '@curios/db-read';
import { ApiError, apiFetch } from '../../../../lib/api.js';
import {
  basketMessage,
  defaultStorageKey,
  priceBasket,
  QUANTITY_MAX,
  readBasket,
  sameLine,
  whatsappOrderUrl,
  writeBasket,
  type BasketLine,
} from '../basket.js';
import { shopCopy } from '../copy.js';
import { payingKey, retryKey } from './paying.js';
import { payButtonText, PayWays, useOnlineOffer, usePayChoice } from './pay-ways.js';
import { Placed } from './placed.js';
import styles from './checkout.module.css';

type ViewItem = ShopItem & Partial<DigitalFacts> & { photoUrl: string | null };
type Method = 'PICKUP' | 'DELIVERY';

/** About five show at phone width; the rest are a sideways scroll away. */
const DAYS_SHOWN = 14;
/** A Malaysian mobile without its 0 is nine digits at the least. */
const PHONE_MIN_DIGITS = 9;
/** Enough to catch a typo; the API and the mail server say the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  /** The owner's QR or full bank details: the "DuitNow QR" choice. Absent reads as yes. */
  payByQr?: boolean;
  /** The owner's own DuitNow QR: with CHIP beside it, the choice is the board's "DuitNow QR". */
  hasQr?: boolean;
  /**
   * The methods the owner's CHIP account listed when last checked; null or absent when
   * the shop takes nothing online. Only the first draw: the API says what it takes at
   * this basket's total.
   */
  chipMethods?: string[] | null;
  /** Where paying online sends the browser. Tests pass a spy. */
  navigate?: (url: string) => void;
}

interface PlacedOrder {
  number: number;
  code: string;
  token: string;
  totalCents: number;
  phone: string;
  /** Paying online could not start (or was tried too often): the order waits for the QR (or WhatsApp) instead. */
  onlineUnavailable: 'unavailable' | 'tooMany' | null;
  /** The small line under a digital order. */
  digitalNote: string | null;
  /** The order holds a code or a class seat until it is paid. */
  holds: boolean;
}

const goTo = (url: string) => window.location.assign(url);

/** Where a refusal is said: under the field it is about, or above Place order. */
type Problem = { field: 'phone' | 'address' | 'day' | 'method' | 'email' | 'form'; message: string };

/** The refusals that belong to one field. Anything else is said above Place order. */
const FIELD_OF: Record<string, Problem['field']> = {
  INVALID_PHONE: 'phone',
  ADDRESS_REQUIRED: 'address',
  ORDER_DATE: 'day',
  METHOD_OFF: 'method',
  EMAIL_REQUIRED: 'email',
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
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pricesChanged, setPricesChanged] = useState(false);
  /** Checkout cannot take this basket: the shop paused, or the order is too big. WhatsApp replaces Place order. */
  const [fallback, setFallback] = useState<'paused' | 'tooLarge' | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const chip = props.chipMethods ?? null;
  const payByQr = props.payByQr ?? true;
  const top = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
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
      email: emailRef.current,
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
        .map((l) => (sameLine(l, line) ? { ...l, quantity } : l))
        // At 0 the line goes, as the board's minus at 1 does.
        .filter((l) => l.quantity > 0),
    );
  }

  const days = useMemo(
    () => openDays({ now: new Date(props.now), minNoticeDays: props.minNoticeDays, closedDays: props.closedDays }, DAYS_SHOWN),
    [props.now, props.minNoticeDays, props.closedDays],
  );
  const priced = useMemo(() => priceBasket(lines, items), [lines, items]);
  // Digital items need no pickup, delivery or day; any physical one in the basket keeps all three.
  const digitalOnly = isDigitalOnly(priced.lines.map((l) => ({ kind: l.digital ? ('DIGITAL' as const) : ('PHYSICAL' as const) })));
  const anyDigital = priced.lines.some((l) => l.digital);
  const mixed = anyDigital && !digitalOnly;
  // A class line needs a time that is still one of the item's and has the seats: else it says so and blocks Place order.
  const timeIssue = (line: (typeof priced.lines)[number]): string | null => {
    const item = items.find((i) => i.id === line.itemId);
    if (item?.delivery !== 'SESSION') return null;
    const time = line.sessionId ? item.sessions?.find((t) => t.id === line.sessionId) : undefined;
    if (!time) return copy.pickTimeFirst;
    if (time.seatsLeft === 0) return copy.full;
    return time.seatsLeft < line.quantity ? copy.seatsLeft(time.seatsLeft) : null;
  };
  const soldOutLine = priced.lines.some((l) => l.soldOut || timeIssue(l) !== null);
  const digitalKinds = [...new Set(priced.lines.flatMap((l) => (l.digital ? [items.find((i) => i.id === l.itemId)?.delivery ?? null] : [])))];
  const onlyKind = digitalKinds.length === 1 ? digitalKinds[0] : null;
  const emailWhat = onlyKind ? ({ FILES: 'files', LINK: 'link', CODES: 'codes', SESSION: 'session' } as const)[onlyKind] : 'mixed';
  const totals = orderTotals(priced.lines, {
    method: digitalOnly ? 'PICKUP' : (method ?? 'PICKUP'),
    mode: delivery.mode,
    feeCents: delivery.feeCents,
  });
  // What CHIP takes at this total, asked through the API once the basket settles.
  const hasChip = chip !== null;
  const offer = useOnlineOffer(props.handle, chip, totals.totalCents);
  // The owner's own QR or bank account, when there is one; storeGaps keeps an open shop
  // without CHIP from having neither, and a shop that slips through gets the WhatsApp line.
  const pick = usePayChoice(offer, payByQr, anyDigital ? email.trim() : null);
  const { ways, how, online } = pick;

  const flatFee = delivery.mode === 'FLAT' && delivery.feeCents ? formatRinggit(delivery.feeCents) : null;
  const deliveryPrice = delivery.mode === 'RIDER' ? copy.riderFee : (flatFee ?? copy.free);

  const canPlace =
    priced.lines.length > 0 &&
    name.trim() !== '' &&
    phone.replace(/\D/g, '').length >= PHONE_MIN_DIGITS &&
    (digitalOnly || (day !== null && method !== null && (method !== 'DELIVERY' || address.trim() !== ''))) &&
    (!anyDigital || EMAIL.test(email.trim())) &&
    !soldOutLine &&
    pick.ready &&
    !sending;

  async function place() {
    if (!canPlace || (!digitalOnly && (!method || !day))) return;
    const sentPhone = phoneToSend(phone);
    setSending(true);
    setProblem(null);
    setPricesChanged(false);
    setDeliveryOff(false);
    // Going to CHIP: the button stays busy until the page is gone.
    let leaving = false;
    try {
      const result = await apiFetch<{ number: number; code: string; token: string; totalCents: number }>(
        `/store/${props.handle}/orders`,
        {
          method: 'POST',
          body: JSON.stringify({
            lines: priced.lines.map(({ itemId, optionId, quantity, sessionId }) => ({ itemId, optionId, quantity, ...(sessionId ? { sessionId } : {}) })),
            ...(digitalOnly ? {} : { method, day }),
            ...(anyDigital ? { email: email.trim() } : {}),
            customerName: name.trim(),
            phone: sentPhone,
            address: !digitalOnly && method === 'DELIVERY' ? address.trim() : null,
            note: note.trim() === '' ? null : note.trim(),
            // Placing the order under the line that says where the number goes is the consent, as on the lead card.
            consent: true,
            seenTotalCents: totals.totalCents,
          }),
        },
      );
      changeLines([]);
      // Placed first, exactly as for the QR; paying online only follows. If it cannot
      // start, the order waits for the QR (or the shop's WhatsApp) like any other.
      let onlineUnavailable: PlacedOrder['onlineUnavailable'] = null;
      if (online && pick.choice) {
        const choice = pick.choice;
        try {
          const paying = await apiFetch<{ url: string | null }>(`/store/orders/${encodeURIComponent(result.token)}/pay`, {
            method: 'POST',
            body: JSON.stringify({ ...choice, email: pick.email.trim() }),
          });
          if (paying.url) {
            try {
              window.sessionStorage.setItem(payingKey(result.token), '1');
            } catch {
              // No storage: the order page shows the order, paid, without the placed screen.
            }
            leaving = true;
            (props.navigate ?? goTo)(paying.url);
            return;
          }
        } catch (error) {
          if (error instanceof ApiError && (error.code === 'ORDER_ALREADY_PAID' || error.code === 'ORDER_RECEIPT_SENT')) {
            // Paid already (an earlier try went through): its order page says so.
            leaving = true;
            (props.navigate ?? goTo)(`/${props.handle}/order/${encodeURIComponent(result.token)}`);
            return;
          }
          if (error instanceof ApiError && error.status === 429) {
            onlineUnavailable = 'tooMany';
            // The order page offers the retry this screen has not got.
            try {
              window.sessionStorage.setItem(retryKey(result.token), '1');
            } catch {
              // No storage: a payment that failed still brings the retry on the order page.
            }
          }
        }
        onlineUnavailable ??= 'unavailable';
      }
      setPlaced({
        number: result.number,
        code: result.code,
        token: result.token,
        totalCents: result.totalCents,
        phone: sentPhone,
        onlineUnavailable,
        digitalNote: anyDigital ? copy.digitalPlacedNote(false, email.trim()) : null,
        holds: priced.lines.some((l) => l.digital && ['CODES', 'SESSION'].includes(items.find((i) => i.id === l.itemId)?.delivery ?? '')),
      });
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
        setProblem({ field: FIELD_OF[error.code] ?? 'form', message: copy.digitalError(error.code) ?? error.message });
      }
    } finally {
      if (!leaving) setSending(false);
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
          number={placed.number}
          code={placed.code}
          token={placed.token}
          totalCents={placed.totalCents}
          phone={placed.phone}
          onlineUnavailable={placed.onlineUnavailable}
          digitalNote={placed.digitalNote}
          holds={placed.holds}
          payByQr={payByQr}
          whatsapp={props.whatsapp}
        />
      </main>
    );
  }

  const shopHref = `/${props.handle}/shop`;
  const total = formatRinggit(totals.totalCents);
  const goText = payButtonText(copy, total, pick) ?? copy.placeOrder(total);
  const payNote = online
    ? `${how === 'card' ? copy.noteCard : how === 'wallet' ? copy.noteWallet : copy.noteBank} ${copy.chipNote(props.displayName)}`
    : `${copy.payNote(props.displayName)} ${copy.consent(props.displayName)}`;

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

      <div className={styles.sheet} data-testid="sheet">
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
                const time = line.sessionId ? item?.sessions?.find((t) => t.id === line.sessionId)?.startsAt : undefined;
                const issue = timeIssue(line);
                return (
                  <li key={`${line.itemId}:${line.optionId ?? ''}:${line.sessionId ?? ''}`} className={styles.line}>
                    <span className={styles.thumb} aria-hidden="true">
                      {item?.photoUrl ? <img src={item.photoUrl} alt="" /> : line.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className={styles.what}>
                      <b>{line.name}</b>
                      <span>
                        {line.soldOut
                          ? copy.soldOut
                          : issue
                            ? issue
                          : line.digital
                            ? copy.digitalSub(
                                { delivery: item?.delivery ?? null, format: item?.format ?? null, minutes: item?.minutes ?? null, place: item?.place ?? null },
                                time ? copy.sessionTime(time) : null,
                              )
                            : `${line.optionLabel ? `${line.optionLabel} · ` : ''}${copy.each(formatRinggit(line.unitCents))}`}
                      </span>
                      {issue && !line.soldOut && item ? (
                        <a className={styles.lite} href={`${shopHref}/${item.slug}`}>
                          {copy.pickATime}
                        </a>
                      ) : null}
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

          {digitalOnly ? (
            <section className={styles.section} aria-labelledby="ck-getting">
              <div className={styles.head}>
                <h2 id="ck-getting">{copy.gettingIt}</h2>
              </div>
              <div className={styles.byEmail}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h18v14H3zM3 7l9 6 9-6" />
                </svg>
                <span>
                  <b>{copy.byEmailRightAfter}</b>
                  <span>{copy.byEmailBody}</span>
                </span>
              </div>
            </section>
          ) : (
          <section className={styles.section} aria-labelledby="ck-getting">
            <div className={styles.head}>
              <h2 id="ck-getting">{copy.gettingIt}</h2>
            </div>
            {mixed ? <p className={styles.mixed}>{copy.mixedLine}</p> : null}
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
          )}

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
            {anyDigital ? (
              <div className={styles.field}>
                <label htmlFor="ck-email">
                  {copy.email} <i>{copy.emailFor(emailWhat)}</i>
                </label>
                <input
                  ref={emailRef}
                  id="ck-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  aria-invalid={problem?.field === 'email' || undefined}
                  aria-describedby={problem?.field === 'email' ? 'ck-email-error' : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (problem?.field === 'email') setProblem(null);
                  }}
                />
                {problem?.field === 'email' ? (
                  <p id="ck-email-error" className={styles.error}>
                    {problem.message}
                  </p>
                ) : null}
              </div>
            ) : null}
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

          <section className={styles.section} aria-labelledby="ck-pay">
            <div className={styles.head}>
              <h2 id="ck-pay">{copy.howYoullPay}</h2>
              <span>{copy.payTo(props.displayName)}</span>
            </div>
            {ways.length === 0 ? (
              // Nothing to pay by here right now (CHIP is the only way and takes nothing, or there is no way at all).
              <p className={styles.notice} role="status">
                {hasChip ? copy.onlineUnavailableWhatsApp(props.displayName) : copy.payOnWhatsApp(props.displayName)}
              </p>
            ) : (
              <PayWays
                copy={copy}
                offer={offer}
                pick={pick}
                qr={
                  hasChip && (props.hasQr ?? true)
                    ? { label: copy.duitnowQr, sub: copy.duitnowQrSub(props.displayName) }
                    : { label: copy.qrOrBank, sub: copy.qrOrBankSub(props.displayName) }
                }
              />
            )}
          </section>

          <section className={`${styles.section} ${styles.summary}`}>
            <div>
              <span>{copy.items}</span>
              <span>{formatRinggit(totals.itemsCents)}</span>
            </div>
            {!digitalOnly && method ? (
              <div>
                <span>{method === 'PICKUP' ? copy.pickupLabel : copy.deliveryLabel}</span>
                <span>{method === 'PICKUP' ? copy.free : deliveryPrice}</span>
              </div>
            ) : null}
            {!digitalOnly ? (
              <div>
                <span>{method === 'DELIVERY' ? copy.deliveryOn : copy.pickupOn}</span>
                <span>{day ? copy.dayLong(day) : copy.pickADay}</span>
              </div>
            ) : null}
            {anyDigital ? (
              <div>
                <span>{copy.digitalItems}</span>
                <span>{copy.byEmail}</span>
              </div>
            ) : null}
            <div className={styles.total}>
              <span>{copy.total}</span>
              <span>{total}</span>
            </div>
            <p>{payNote}</p>
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
              {goText}
            </button>
          )}
        </>
      )}
      </div>
    </main>
  );
}
