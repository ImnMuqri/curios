'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ShopCopy } from '../[handle]/shop/copy.js';
import type { LandsCheckoutCopy } from './copy.js';
import { SWATCHES } from './personas.js';
import styles from './lands.module.css';

export type CheckoutAt = 'top' | 'get' | 'day' | 'you' | 'pay' | 'sum';

export interface CheckoutState {
  screen: 'chat' | 'checkout' | 'paid';
  at: CheckoutAt;
  pickup: boolean;
  day: boolean;
  name: string;
  phone: string;
  typing: 'name' | 'phone' | null;
  fpx: boolean;
  bank: boolean;
  pressed: boolean;
  paying: boolean;
}

export const CHECKOUT_START: CheckoutState = {
  screen: 'chat',
  at: 'top',
  pickup: false,
  day: false,
  name: '',
  phone: '',
  typing: null,
  fpx: false,
  bank: false,
  pressed: false,
  paying: false,
};

/**
 * Kek Lina's checkout, drawn inside the chat phone (Landing2 board, L2:733–748),
 * in the real checkout's own words (`shop`). Pure: the run owns the state,
 * and this only draws it. The sheet scrolls by a transform to the section the
 * run is on.
 */
export function LandsCheckout({ shop, copy, state, owner }: { shop: ShopCopy; copy: LandsCheckoutCopy; state: CheckoutState; owner: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  useLayoutEffect(() => {
    const el = state.at === 'top' ? null : inner.current?.querySelector<HTMLElement>(`[data-at="${state.at}"]`);
    if (!el || !inner.current || !sheet.current) {
      setY(0);
      return;
    }
    const max = Math.max(0, inner.current.scrollHeight - sheet.current.clientHeight + 10);
    setY(Math.min(max, Math.max(0, el.offsetTop - 8)));
  }, [state.at]);

  const total = copy.price;
  const goLabel = state.paying ? shop.toPayment : state.bank ? shop.payWith(total, copy.banks[0]) : copy.pay(total);

  return (
    <>
      <div className={`${styles.scr} ${styles.lck}`} data-on={state.screen === 'checkout' ? '' : undefined} data-was={state.screen === 'paid' ? '' : undefined} data-screen={state.screen === 'checkout' ? 'checkout' : undefined}>
        <div className={styles.lckTop}>
          <i aria-hidden="true">‹</i>
          <span>{owner}</span>
        </div>
        <p className={styles.lckT}>{shop.checkout}</p>
        <div ref={sheet} className={styles.lckSh}>
          <div ref={inner} className={styles.lckIn} style={{ transform: y ? `translateY(${-y}px)` : undefined }}>
            <section>
              <div className={styles.lh}>
                <b>{shop.yourOrder}</b>
                <a>{shop.addMore}</a>
              </div>
              <div className={styles.lline}>
                <span className={styles.lth} style={{ background: SWATCHES.coklat }} />
                <span className={styles.lw}>
                  <b>{copy.item}</b>
                  <small>{copy.itemSub}</small>
                </span>
                <span className={styles.lstp}>
                  <i>−</i>
                  <b>1</b>
                  <i>+</i>
                </span>
                <em>{total}</em>
              </div>
            </section>
            <section data-at="get">
              <div className={styles.lh}>
                <b>{shop.gettingIt}</b>
              </div>
              <div className={styles.lmt} data-pick="pickup" data-sel={state.pickup ? '' : undefined}>
                <i />
                <span>
                  <b>{shop.pickupLabel}</b>
                  <small>{copy.pickupWhere}</small>
                </span>
                <em>{copy.free}</em>
              </div>
              <div className={styles.lmt}>
                <i />
                <span>
                  <b>{shop.deliveryLabel}</b>
                  <small>{copy.deliveryWhere}</small>
                </span>
                <em>{copy.deliveryFee}</em>
              </div>
            </section>
            <section data-at="day">
              <div className={styles.lh}>
                <b>{copy.dayTitle}</b>
                <small>{copy.dayHint}</small>
              </div>
              <div className={styles.ldays}>
                {copy.days.map((d, i) => (
                  <span key={d} data-day={i} data-sel={state.day && i === 1 ? '' : undefined}>
                    {d}
                  </span>
                ))}
              </div>
            </section>
            <section data-at="you">
              <div className={styles.lh}>
                <b>{shop.yourDetails}</b>
              </div>
              <label>{shop.name}</label>
              <div className={styles.lfi} data-field="name" data-ty={state.typing === 'name' ? '' : undefined}>
                {state.name}
              </div>
              <label>{shop.whatsappNumber}</label>
              <div className={styles.lfi} data-field="phone" data-ty={state.typing === 'phone' ? '' : undefined}>
                {state.phone}
              </div>
            </section>
            <section data-at="pay">
              <div className={styles.lh}>
                <b>{shop.howYoullPay}</b>
                <small>{shop.payTo(owner)}</small>
              </div>
              <div className={styles.lpw} data-pay="fpx" data-sel={state.fpx ? '' : undefined}>
                <i />
                <span>
                  <b>{shop.onlineBanking}</b>
                  <small>{shop.onlineBankingSub}</small>
                </span>
              </div>
              <div className={styles.lbanks} data-in={state.fpx ? '' : undefined}>
                <div>
                  {copy.banks.map((b, i) => (
                    <span key={b} data-sel={state.bank && i === 0 ? '' : undefined}>
                      {b}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.lpw}>
                <i />
                <span>
                  <b>{shop.eWallet}</b>
                </span>
              </div>
              <div className={styles.lpw}>
                <i />
                <span>
                  <b>{shop.card}</b>
                  <small>{shop.cardSub}</small>
                </span>
              </div>
              <div className={styles.lpw}>
                <i />
                <span>
                  <b>{shop.duitnowQr}</b>
                  <small>{shop.duitnowQrSub(owner)}</small>
                </span>
              </div>
            </section>
            <section data-at="sum" className={styles.lsum}>
              <div>
                <span>{shop.items}</span>
                <span>{total}</span>
              </div>
              <div>
                <span>{shop.pickupLabel}</span>
                <span>{copy.free}</span>
              </div>
              <div>
                <span>{shop.pickupOn}</span>
                <span>{state.day ? copy.dayLong : shop.pickADay}</span>
              </div>
              <div className={styles.ltot}>
                <span>{shop.total}</span>
                <span>{total}</span>
              </div>
            </section>
          </div>
          <div className={styles.lgo} data-off={state.bank ? undefined : ''} data-press={state.pressed ? '' : undefined}>
            {state.paying ? <span className={styles.spin} /> : null}
            {goLabel}
          </div>
        </div>
      </div>
      <div className={`${styles.scr} ${styles.lpl}`} data-on={state.screen === 'paid' ? '' : undefined} data-screen={state.screen === 'paid' ? 'paid' : undefined}>
        <div className={styles.lckTop}>
          <i aria-hidden="true">‹</i>
          <span>{owner}</span>
        </div>
        <div className={styles.lplSh}>
          <div className={styles.okb}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <p className={styles.rcT}>{shop.paidPlaced}</p>
          <p className={styles.rcS}>{shop.paidPlacedSub(total, owner)}</p>
          <div className={styles.lcode}>
            <small>{shop.yourCode}</small>
            <b>{copy.code}</b>
          </div>
          <p className={styles.rcS}>{copy.keep(copy.code)}</p>
          <div className={styles.lgo}>{shop.seeOrder}</div>
        </div>
      </div>
    </>
  );
}
