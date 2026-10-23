'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatRinggit } from '@curios/core/store';
import type { ShopItem } from '@curios/db-read';
import { addToBasket, BASKET_EVENT, defaultStorageKey, priceBasket, QUANTITY_MAX, readBasket, writeAddedNote, writeBasket, type BasketLine } from '../basket.js';
import { shopCopy } from '../copy.js';
import styles from './product.module.css';

export type ProductItem = ShopItem & { photoUrl: string | null };

const ICON = {
  back: 'M15 6l-6 6 6 6',
  basket: 'M5 8h14l-1.4 11.2a1 1 0 0 1-1 .8H7.4a1 1 0 0 1-1-.8zM9 8V6a3 3 0 0 1 6 0v2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  shield: 'M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z',
  chat: 'M4 5h16v11H8l-4 4z',
  more: 'M9 6l6 6-6 6',
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * One product, as the Public board draws it: the photo at 4:3, the tag, name,
 * price and description, a card per size, what the shop needs of an order, a
 * way to ask about it, and a bar to choose how many and add. It reads and
 * writes the same sessionStorage basket the shop does; adding goes back to
 * the shop, as the board does. `inline` is the Store editor's preview, where
 * nothing may navigate away from the editor.
 */
export function ProductView(props: {
  handle: string;
  displayName: string;
  language: string;
  item: ProductItem;
  /** The whole shelf, so the basket's count ignores a line whose item has gone. */
  items: Pick<ShopItem, 'id' | 'name' | 'priceCents' | 'options'>[];
  halal: boolean;
  noticeDays: number;
  /** The first day an order could be for (an ISO date), or null (paused, or no way to get the order). */
  nextDay: string | null;
  pickup: boolean;
  /** sessionStorage key for the basket. Default `curios-basket:${handle}`. */
  storageKey?: string;
  inline?: boolean;
  /** Called once an add is saved. Default: go back to the shop. */
  onDone?: () => void;
}) {
  const { item } = props;
  const copy = shopCopy(props.language);
  const key = props.storageKey ?? defaultStorageKey(props.handle);
  const shopHref = `/${props.handle}/shop`;
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [optionId, setOptionId] = useState<string | null>(item.options[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [announce, setAnnounce] = useState('');

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

  const count = useMemo(() => priceBasket(basket, props.items).lines.reduce((sum, line) => sum + line.quantity, 0), [basket, props.items]);

  const option = item.options.find((candidate) => candidate.id === optionId) ?? null;
  const unitCents = item.options.length > 0 ? (option?.priceCents ?? null) : item.priceCents;
  const total = unitCents === null ? null : formatRinggit(unitCents * quantity);

  const day = props.nextDay ? copy.dayLong(props.nextDay) : null;
  const notice = copy.productNotice(props.noticeDays, day, props.pickup);

  // A preview must not leave the editor: every link in it just stays put.
  const stay = props.inline ? (event: { preventDefault: () => void }) => event.preventDefault() : undefined;
  const back = props.inline ? (event: { preventDefault: () => void }) => { event.preventDefault(); props.onDone?.(); } : undefined;
  const q = encodeURIComponent(copy.askPrefill(item.name));

  function add() {
    if (unitCents === null) return;
    const line: BasketLine = { itemId: item.id, optionId: item.options.length > 0 ? optionId : null, quantity };
    const next = addToBasket(readBasket(key), line);
    writeBasket(key, next);
    setAnnounce(
      copy.addedNamed(
        item.name,
        next.filter((l) => l.itemId === item.id).reduce((sum, l) => sum + l.quantity, 0),
      ),
    );
    // The page we are about to leave cannot be heard saying it; the shop says it on arrival.
    if (!props.inline) writeAddedNote(props.handle, copy.addedNamed(item.name, next.filter((l) => l.itemId === item.id).reduce((sum, l) => sum + l.quantity, 0)));
    if (props.onDone) props.onDone();
    else window.location.assign(shopHref);
  }

  return (
    <div className={styles.view} data-inline={props.inline || undefined}>
      <div className={styles.top}>
        <a className={styles.ib} href={shopHref} aria-label={copy.backToShop} onClick={back}>
          <Icon d={ICON.back} />
        </a>
        <span>{copy.shopOf(props.displayName)}</span>
        <a className={`${styles.ib} ${styles.bk}`} href={`${shopHref}/checkout`} aria-label={copy.basketLabel} onClick={stay}>
          <Icon d={ICON.basket} />
          {count > 0 ? <i>{count}</i> : null}
        </a>
      </div>
      <p className={styles.sr} role="status">
        {announce}
      </p>

      <div className={styles.hero}>
        <span aria-hidden="true">{item.name.trim().charAt(0).toUpperCase()}</span>
        {item.photoUrl ? <img src={item.photoUrl} alt="" /> : null}
      </div>

      <div className={styles.pd}>
        {item.tag ? <span className={styles.ptag}>{item.tag}</span> : null}
        <h1>{item.name}</h1>
        {unitCents !== null ? (
          <p className={styles.price} data-testid="price">
            {formatRinggit(unitCents)}
          </p>
        ) : null}
        {item.description ? <p className={styles.desc}>{item.description}</p> : null}

        {item.options.length > 0 ? (
          <>
            <span className={styles.lbl} id="product-size">
              {copy.sizeLabel}
            </span>
            <div className={styles.opts} role="radiogroup" aria-labelledby="product-size">
              {item.options.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={o.id === optionId}
                  tabIndex={o.id === optionId ? 0 : -1}
                  onClick={() => setOptionId(o.id)}
                  onKeyDown={(event) => {
                    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                    if (step === 0) return;
                    event.preventDefault();
                    const next = item.options[(i + step + item.options.length) % item.options.length];
                    if (!next) return;
                    setOptionId(next.id);
                    (event.currentTarget.parentElement?.children[item.options.indexOf(next)] as HTMLElement | undefined)?.focus();
                  }}
                >
                  <b>{o.label}</b>
                  <span>{formatRinggit(o.priceCents)}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {notice || props.halal ? (
          <div className={styles.facts}>
            {notice ? (
              <div>
                <Icon d={ICON.clock} />
                {notice}
              </div>
            ) : null}
            {props.halal ? (
              <div>
                <Icon d={ICON.shield} />
                {copy.halalLine}
              </div>
            ) : null}
          </div>
        ) : null}

        <a className={styles.askit} href={`/${props.handle}?q=${q}#ask`} onClick={stay}>
          <Icon d={ICON.chat} />
          <span>
            <b>{copy.askAboutThis}</b>
            <small>{copy.askSamples}</small>
          </span>
          <Icon d={ICON.more} />
        </a>
      </div>

      {unitCents !== null ? (
        <div className={styles.bar}>
          <span className={styles.qty}>
            <button type="button" aria-label={copy.oneLess} onClick={() => setQuantity((n) => Math.max(1, n - 1))}>
              −
            </button>
            <b data-testid="qty">{quantity}</b>
            <button type="button" aria-label={copy.oneMore} onClick={() => setQuantity((n) => Math.min(QUANTITY_MAX, n + 1))}>
              +
            </button>
          </span>
          <button type="button" className={styles.go} onClick={add}>
            {copy.addToBasket(total ?? '')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
