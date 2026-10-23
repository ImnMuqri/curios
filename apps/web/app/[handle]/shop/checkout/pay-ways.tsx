'use client';

import { useEffect, useState } from 'react';
import { FPX_BANKS, onlineOffer, WALLETS, type FpxBankId, type OnlineChoice, type OnlineOffer, type WalletId } from '@curios/core/shop-pay';
import { apiFetch } from '../../../../lib/api.js';
import type { ShopCopy } from '../copy.js';
import styles from './checkout.module.css';

/** The board's four ways to pay: three through the owner's CHIP account, and their own QR. */
export type Way = 'fpx' | 'wallet' | 'card' | 'qr';

/** Enough to catch a typo; CHIP and the API say the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What the owner's CHIP account takes at this total: the methods it listed when last
 * checked for the first draw, then what the API says at this total once it settles.
 * Null when the shop takes nothing online.
 */
export function useOnlineOffer(handle: string, chipMethods: string[] | null, totalCents: number): OnlineOffer | null {
  const [offer, setOffer] = useState<OnlineOffer | null>(chipMethods ? onlineOffer(chipMethods) : null);
  const hasChip = chipMethods !== null;
  useEffect(() => {
    if (!hasChip || totalCents <= 0) return;
    let stale = false;
    const timer = setTimeout(() => {
      apiFetch<OnlineOffer>(`/store/${handle}/pay-methods?amount=${totalCents}`)
        .then((next) => {
          if (!stale) setOffer(next);
        })
        .catch(() => {
          // Keep what the page drew; paying says so if CHIP cannot take it.
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [hasChip, handle, totalCents]);
  return offer;
}

/**
 * The choice of how to pay, shared by checkout and the order page's retry: the ways on
 * offer (the owner's QR only where `withQr`), the bank or e-wallet under them, and the
 * email an online choice asks for (owner's answer 2).
 */
export function usePayChoice(offer: OnlineOffer | null, withQr: boolean) {
  const [way, setWay] = useState<Way | null>(null);
  const [bank, setBank] = useState<FpxBankId>('maybank');
  const [wallet, setWallet] = useState<WalletId | null>(null);
  const [email, setEmail] = useState('');

  const ways: Way[] = [];
  if (offer?.fpx) ways.push('fpx');
  if (offer && offer.wallets.length > 0) ways.push('wallet');
  if (offer?.card) ways.push('card');
  if (withQr) ways.push('qr');
  const how: Way | null = way && ways.includes(way) ? way : (ways[0] ?? null);
  const walletPick: WalletId | null = wallet && offer?.wallets.includes(wallet) ? wallet : (offer?.wallets[0] ?? null);
  const online = how === 'fpx' || how === 'wallet' || how === 'card';
  const choice: OnlineChoice | null =
    how === 'fpx' ? { method: 'fpx', bank } : how === 'card' ? { method: 'card' } : how === 'wallet' && walletPick ? { method: walletPick } : null;
  /** An online choice is ready to send: its email looks right and an e-wallet is picked. */
  const ready = !online || (EMAIL.test(email.trim()) && (how !== 'wallet' || walletPick !== null));

  return { ways, how, setWay, bank, setBank, walletPick, setWallet, email, setEmail, online, choice, ready };
}

export type PayChoice = ReturnType<typeof usePayChoice>;

/** "Pay RM215 with Maybank2u", "Pay RM215 by card": the button under an online choice. */
export function payButtonText(copy: ShopCopy, total: string, pick: PayChoice): string | null {
  if (pick.how === 'fpx') return copy.payWith(total, FPX_BANKS.find((b) => b.id === pick.bank)?.name ?? '');
  if (pick.how === 'wallet') return copy.payWith(total, WALLETS.find((w) => w.id === pick.walletPick)?.name ?? '');
  if (pick.how === 'card') return copy.payByCard(total);
  return null;
}

/**
 * The board's "How you'll pay" choices (Public board, checkout), the bank or e-wallet
 * under the one chosen, and the email for the receipt. `qr` names the owner's own QR
 * choice, when it is one of the ways.
 */
export function PayWays({
  copy,
  offer,
  pick,
  qr,
  idPrefix = 'ck',
}: {
  copy: ShopCopy;
  offer: OnlineOffer | null;
  pick: PayChoice;
  qr?: { label: string; sub: string };
  /** Keeps ids apart where two sets could share a page. */
  idPrefix?: string;
}) {
  const wayText: Record<Way, { label: string; sub: string; marks: { text: string; className: string | undefined }[] }> = {
    fpx: { label: copy.onlineBanking, sub: copy.onlineBankingSub, marks: [{ text: 'FPX', className: styles.markFpx }] },
    wallet: {
      label: copy.eWallet,
      sub: (offer?.wallets ?? []).map((id) => WALLETS.find((w) => w.id === id)?.name).join(', '),
      marks: [
        ...(offer?.wallets.includes('tng') ? [{ text: 'TNG', className: styles.markTng }] : []),
        ...(offer?.wallets.includes('grab') ? [{ text: 'Grab', className: styles.markGrab }] : []),
      ],
    },
    card: { label: copy.card, sub: copy.cardSub, marks: [{ text: 'VISA', className: styles.markVisa }, { text: 'MC', className: styles.markMc }] },
    qr: { label: qr?.label ?? copy.qrOrBank, sub: qr?.sub ?? '', marks: [{ text: 'QR', className: styles.markQr }] },
  };

  return (
    <>
      <div className={styles.methods} role="radiogroup" aria-label={copy.howYoullPay}>
        {pick.ways.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={pick.how === w} className={styles.method} onClick={() => pick.setWay(w)}>
            <i className={styles.radio} aria-hidden="true" />
            <span className={styles.methodText}>
              <b>{wayText[w].label}</b>
              <span>{wayText[w].sub}</span>
            </span>
            <span className={styles.marks} aria-hidden="true">
              {wayText[w].marks.map((mark) => (
                <i key={mark.text} className={mark.className}>
                  {mark.text}
                </i>
              ))}
            </span>
          </button>
        ))}
      </div>
      {pick.how === 'fpx' ? (
        <>
          <div className={`${styles.head} ${styles.subHead}`}>
            <h3 id={`${idPrefix}-bank`}>{copy.yourBank}</h3>
          </div>
          <div className={styles.picks} role="radiogroup" aria-labelledby={`${idPrefix}-bank`}>
            {FPX_BANKS.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={pick.bank === b.id} className={styles.pick} data-mark={b.id} onClick={() => pick.setBank(b.id)}>
                <i aria-hidden="true">{b.name.charAt(0)}</i>
                {b.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {pick.how === 'wallet' ? (
        <>
          <div className={`${styles.head} ${styles.subHead}`}>
            <h3 id={`${idPrefix}-wallet`}>{copy.yourWallet}</h3>
          </div>
          <div className={styles.picks} role="radiogroup" aria-labelledby={`${idPrefix}-wallet`}>
            {WALLETS.filter((w) => offer?.wallets.includes(w.id)).map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={pick.walletPick === w.id} className={styles.pick} data-mark={w.id} onClick={() => pick.setWallet(w.id)}>
                <i aria-hidden="true">{w.name.charAt(0)}</i>
                {w.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {pick.online ? (
        <div className={styles.field}>
          <label htmlFor={`${idPrefix}-email`}>
            {copy.email} <i>{copy.forReceipt}</i>
          </label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            value={pick.email}
            onChange={(event) => pick.setEmail(event.target.value)}
          />
        </div>
      ) : null}
    </>
  );
}
