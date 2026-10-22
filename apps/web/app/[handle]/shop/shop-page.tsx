'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatRinggit, fromPrice, type DeliveryMode } from '@curios/core/store';
import { BASKET_EVENT, defaultStorageKey, readBasket, writeBasket, type BasketLine } from './basket.js';
import { shopCopy } from './copy.js';
import { ItemSheet, type ViewItem } from './shop-view.js';
import styles from './shop-page.module.css';

const ICON = {
  back: 'M15 6l-6 6 6 6',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  area: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  halal: 'M5 13l4 4L19 7',
  store: 'M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9l2-5h12l2 5',
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * /[handle]/shop as the Public board draws it: its own top bar, the sign, the
 * owner's note, category chips, two-column cards and the "not listed?" card.
 * The page's theme comes from the wrapper (PageTheme), so everything here
 * follows the owner's background and accent. The basket bar is the page's own
 * BasketBar, which reads the same sessionStorage basket this writes.
 */
export function ShopPageView(props: {
  handle: string;
  displayName: string;
  language: string;
  items: ViewItem[];
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  canTakeOrders: boolean;
  /** The next day an order could be for (an ISO date), or null (paused, or no way to get the order). */
  nextDay: string | null;
  description: string | null;
  halal: boolean;
  initialItemId: string | null;
}) {
  const copy = shopCopy(props.language);
  const key = defaultStorageKey(props.handle);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(props.items.some((i) => i.id === props.initialItemId) ? props.initialItemId : null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const read = () => setBasket(readBasket(key));
    read();
    window.addEventListener(BASKET_EVENT, read);
    window.addEventListener('pageshow', read);
    return () => {
      window.removeEventListener(BASKET_EVENT, read);
      window.removeEventListener('pageshow', read);
    };
  }, [key]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of props.items) {
      const name = item.category?.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts];
  }, [props.items]);
  const shown = category ? props.items.filter((item) => item.category?.trim() === category) : props.items;
  const open = props.items.find((item) => item.id === openId) ?? null;

  function add(line: BasketLine) {
    const current = readBasket(key);
    const same = current.find((l) => l.itemId === line.itemId && l.optionId === line.optionId);
    writeBasket(
      key,
      same ? current.map((l) => (l === same ? { ...l, quantity: l.quantity + line.quantity } : l)) : [...current, line],
    );
    setOpenId(null);
  }

  async function share() {
    const url = `${window.location.origin}/${props.handle}/shop`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: props.displayName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // A dismissed share sheet rejects; nothing to say.
    }
  }

  const delivers = props.deliveryMode !== 'NONE';
  const how = props.pickupEnabled ? (delivers ? copy.pickupOrDelivery : copy.pickupOnly) : delivers ? copy.deliveryOnly : null;
  const day = props.nextDay ? copy.dayLong(props.nextDay) : null;
  const initial = props.displayName.trim().charAt(0).toUpperCase();

  return (
    <div className={styles.shop}>
      <div className={styles.top}>
        <a className={styles.ib} href={`/${props.handle}`} aria-label={copy.backTo(props.displayName)}>
          <Icon d={ICON.back} />
        </a>
        <span>curios.my/{props.handle}/shop</span>
        <button type="button" className={styles.ib} aria-label={copy.shareShop} onClick={() => void share()}>
          <Icon d={ICON.share} />
        </button>
      </div>
      {copied ? (
        <p className={styles.toast} role="status">
          {copy.linkCopied}
        </p>
      ) : null}

      <div className={styles.sign}>
        <span className={styles.open} data-paused={props.canTakeOrders ? undefined : ''}>
          <i aria-hidden="true" />
          {props.canTakeOrders ? copy.openForOrders : copy.ordersPaused}
        </span>
        <h1 className={styles.name}>{props.displayName}</h1>
        <ul className={styles.facts}>
          {props.pickupNote ? (
            <li>
              <Icon d={ICON.area} />
              {props.pickupNote}
            </li>
          ) : null}
          {how ? (
            <li>
              <Icon d={ICON.truck} />
              {how}
            </li>
          ) : null}
          {day ? (
            <li>
              <Icon d={ICON.calendar} />
              {props.pickupEnabled ? copy.factNextPickup(day) : copy.factNextDelivery(day)}
            </li>
          ) : null}
          {props.halal ? (
            <li>
              <Icon d={ICON.halal} />
              {copy.halal}
            </li>
          ) : null}
        </ul>
      </div>

      {props.description ? (
        <div className={styles.own} role="note">
          <span className={styles.av} aria-hidden="true">
            {initial}
          </span>
          <div className={styles.bubble}>
            <p>{props.description}</p>
            <small>{props.displayName}</small>
          </div>
        </div>
      ) : null}

      {props.items.length > 0 ? (
        <>
          {categories.length > 0 ? (
            <div className={styles.cats} role="group" aria-label={copy.categories}>
              <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}>
                {copy.allItems}
                <em>{props.items.length}</em>
              </button>
              {categories.map(([name, count]) => (
                <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>
                  {name}
                  <em>{count}</em>
                </button>
              ))}
            </div>
          ) : null}
          <ul className={styles.grid}>
            {shown.map((item) => {
              const from = fromPrice(item);
              const inBasket = basket.filter((line) => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
              const buyable = item.options.length > 0 || item.priceCents !== null;
              return (
                <li key={item.id} className={styles.card}>
                  <span className={styles.pic}>
                    {item.photoUrl ? <img src={item.photoUrl} alt="" /> : item.name.trim().charAt(0).toUpperCase()}
                    {item.tag ? <span className={styles.tag}>{item.tag}</span> : null}
                    {buyable ? (
                      <button
                        type="button"
                        className={styles.add}
                        data-has={inBasket > 0 ? '' : undefined}
                        aria-label={copy.addNamed(item.name)}
                        onClick={() => add({ itemId: item.id, optionId: item.options[0]?.id ?? null, quantity: 1 })}
                      >
                        {inBasket > 0 ? inBasket : '+'}
                      </button>
                    ) : null}
                  </span>
                  <button type="button" className={styles.cn} onClick={() => setOpenId(item.id)}>
                    {item.name}
                  </button>
                  <span className={styles.cp}>
                    {from === null ? '' : item.options.length > 0 ? copy.from(formatRinggit(from)) : formatRinggit(from)}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className={styles.foot}>
            <b>{copy.wantMore}</b>
            {copy.wantMoreBody(props.displayName)}
            <br />
            <a href={`/${props.handle}#ask`}>{copy.askQuestion}</a>
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <span className={styles.ei}>
            <Icon d={ICON.store} />
          </span>
          <b>{copy.emptyTitle}</b>
          <p>{copy.emptyBody(props.displayName)}</p>
          <a className={styles.lite} href={`/${props.handle}#ask`}>
            {copy.askName(props.displayName)}
          </a>
        </div>
      )}

      {open ? <ItemSheet key={open.id} item={open} copy={copy} inline={false} onAdd={add} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
