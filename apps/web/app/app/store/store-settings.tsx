'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import {
  BANK_ACCOUNT_NAME_MAX,
  BANK_NAME_MAX,
  DELIVERY_FEE_MAX_CENTS,
  MIN_NOTICE_DAYS_MAX,
  PICKUP_NOTE_MAX,
  parseRinggit,
  storeGapMessage,
  storeGaps,
} from '@curios/core/store';
import type { OwnerStore } from '@curios/db-read';
import panel from '../panel.module.css';
import styles from './store.module.css';

export type StoreSettings = OwnerStore['settings'];
type Patch = Partial<Omit<StoreSettings, 'paymentQrKey'>>;

export type StoreSettingsApi = {
  save: (patch: Patch) => Promise<StoreSettings>;
  /** Resolves to the public URL of the stored QR. */
  uploadQr: (file: File) => Promise<string>;
  removeQr: () => Promise<void>;
};

const FEE_SENTENCE = 'Give flat delivery a fee above RM0, up to RM500.';
const NOTICE_SENTENCE = `Notice is a whole number of days, from 0 to ${MIN_NOTICE_DAYS_MAX}.`;

/** 1000 -> "10", 1050 -> "10.50": a fee as the owner would type it. */
function ringgitText(cents: number | null): string {
  if (cents === null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

const text = (value: string | null) => value ?? '';
const orNull = (value: string) => value.trim() || null;

/**
 * The shop's settings, saved together. Not autosaved: whether the shop may
 * open depends on several fields at once (a way to pay, a way to hand over),
 * and a half-typed bank account is not something to send.
 */
export function StoreSettingsForm({
  initial,
  uploadsEnabled,
  qrUrl,
  api,
  onSaved,
}: {
  initial: StoreSettings;
  uploadsEnabled: boolean;
  qrUrl: string | null;
  api: StoreSettingsApi;
  /** Called with the settings the API returned, once a save has taken effect. */
  onSaved?: (settings: StoreSettings) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [pickupEnabled, setPickupEnabled] = useState(initial.pickupEnabled);
  const [pickupNote, setPickupNote] = useState(text(initial.pickupNote));
  const [deliveryMode, setDeliveryMode] = useState(initial.deliveryMode);
  const [fee, setFee] = useState(ringgitText(initial.deliveryFeeCents));
  const [notice, setNotice] = useState(String(initial.minNoticeDays));
  const [bankName, setBankName] = useState(text(initial.bankName));
  const [bankAccountName, setBankAccountName] = useState(text(initial.bankAccountName));
  const [bankAccountNumber, setBankAccountNumber] = useState(text(initial.bankAccountNumber));

  const [hasQr, setHasQr] = useState(Boolean(initial.paymentQrKey));
  const [qrPicture, setQrPicture] = useState(qrUrl);
  const [qrFailed, setQrFailed] = useState(false);
  const [qrError, setQrError] = useState('');

  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const gaps = storeGaps({
    pickupEnabled,
    deliveryMode,
    paymentQrKey: hasQr ? 'qr' : null,
    bankName: orNull(bankName),
    bankAccountName: orNull(bankAccountName),
    bankAccountNumber: orNull(bankAccountNumber),
  });

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setQrError('');
    try {
      setQrPicture(await api.uploadQr(file));
      setQrFailed(false);
      setHasQr(true);
    } catch (failure) {
      setQrError(failure instanceof Error ? failure.message : 'That picture could not be used.');
    }
  }

  async function removeQr() {
    setQrError('');
    try {
      await api.removeQr();
      setHasQr(false);
      setQrPicture(null);
    } catch (failure) {
      // The QR stays: the API refuses when it is the shop's only way to pay.
      setQrError(failure instanceof Error ? failure.message : 'That did not save. Try again.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    setError('');

    const patch: Patch = {};
    if (enabled !== saved.enabled) patch.enabled = enabled;
    if (pickupEnabled !== saved.pickupEnabled) patch.pickupEnabled = pickupEnabled;
    if (orNull(pickupNote) !== saved.pickupNote) patch.pickupNote = orNull(pickupNote);
    if (orNull(bankName) !== saved.bankName) patch.bankName = orNull(bankName);
    if (orNull(bankAccountName) !== saved.bankAccountName) patch.bankAccountName = orNull(bankAccountName);
    if (orNull(bankAccountNumber) !== saved.bankAccountNumber) patch.bankAccountNumber = orNull(bankAccountNumber);
    if (deliveryMode !== saved.deliveryMode) patch.deliveryMode = deliveryMode;

    if (deliveryMode === 'FLAT') {
      const cents = parseRinggit(fee);
      if (cents === null || cents <= 0 || cents > DELIVERY_FEE_MAX_CENTS) {
        setError(FEE_SENTENCE);
        return;
      }
      if (cents !== saved.deliveryFeeCents) patch.deliveryFeeCents = cents;
    }

    const trimmed = notice.trim();
    const days = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isInteger(days) || days > MIN_NOTICE_DAYS_MAX) {
      setError(NOTICE_SENTENCE);
      return;
    }
    if (days !== saved.minNoticeDays) patch.minNoticeDays = days;

    if (Object.keys(patch).length === 0) {
      setDone(true);
      return;
    }

    setBusy(true);
    try {
      const next = await api.save(patch);
      setSaved(next);
      onSaved?.(next);
      setDone(true);
    } catch (failure) {
      // Verbatim: STORE_NOT_READY names exactly what is missing.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={panel.stack}>
      <section className={panel.panel} aria-labelledby="open-title">
        <h2 id="open-title" className={panel.panelTitle}>Open shop</h2>
        <label className={panel.check}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={gaps.length > 0 && !enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Open shop
        </label>
        {gaps.length > 0 ? <p className={styles.gap}>{storeGapMessage(gaps)}</p> : null}
        {saved.enabled ? <p className={styles.note}>Your shop is open to customers.</p> : null}
      </section>

      <section className={panel.panel} aria-labelledby="pay-title">
        <h2 id="pay-title" className={panel.panelTitle}>How customers pay</h2>
        <p className={panel.text}>Add a DuitNow QR, your bank account, or both.</p>
        <div className={styles.qrRow}>
          {hasQr && qrPicture && !qrFailed ? (
            <img src={qrPicture} alt="Your payment QR" className={styles.qr} onError={() => setQrFailed(true)} />
          ) : null}
          <div className={styles.qrActions}>
            {uploadsEnabled ? null : <p className={styles.note}>Uploading pictures is switched off here.</p>}
            <label className={styles.upload} data-disabled={!uploadsEnabled}>
              <span aria-hidden="true">{hasQr ? 'Change QR' : 'Upload a QR'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Upload a payment QR"
                disabled={!uploadsEnabled}
                className={styles.visuallyHidden}
                onChange={(event) => void upload(event)}
              />
            </label>
            {hasQr ? (
              <Button variant="secondary" onClick={() => void removeQr()}>Remove QR</Button>
            ) : null}
          </div>
        </div>
        {qrError ? <Callout tone="error">{qrError}</Callout> : null}
        <Field id="bank-name" label="Bank name" value={bankName} onChange={setBankName} hint={`Up to ${BANK_NAME_MAX} characters.`} />
        <Field id="bank-account-name" label="Account name" value={bankAccountName} onChange={setBankAccountName} hint={`Up to ${BANK_ACCOUNT_NAME_MAX} characters.`} />
        <Field id="bank-account-number" label="Account number" value={bankAccountNumber} onChange={setBankAccountNumber} />
      </section>

      <section className={panel.panel} aria-labelledby="pickup-title">
        <h2 id="pickup-title" className={panel.panelTitle}>Pickup</h2>
        <label className={panel.check}>
          <input type="checkbox" checked={pickupEnabled} onChange={(event) => setPickupEnabled(event.target.checked)} />
          Offer pickup
        </label>
        {pickupEnabled ? (
          <Field id="pickup-note" label="Pickup note" value={pickupNote} onChange={setPickupNote} hint={`Where and when, up to ${PICKUP_NOTE_MAX} characters.`} />
        ) : null}
      </section>

      <section className={panel.panel} aria-labelledby="delivery-title">
        <h2 id="delivery-title" className={panel.panelTitle}>Delivery</h2>
        <div className={styles.choices} role="radiogroup" aria-labelledby="delivery-title">
          {(
            [
              ['NONE', 'No delivery'],
              ['FLAT', 'Flat fee'],
              ['RIDER', 'Rider paid separately'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={panel.check}>
              <input type="radio" name="delivery" checked={deliveryMode === value} onChange={() => setDeliveryMode(value)} />
              {label}
            </label>
          ))}
        </div>
        {deliveryMode === 'FLAT' ? (
          <Field id="delivery-fee" label="Delivery fee (RM)" value={fee} onChange={setFee} hint="Added to every delivery order. Up to RM500." />
        ) : null}
        {deliveryMode === 'RIDER' ? (
          <p className={styles.note}>Customers pay the rider directly. It is never added to their total.</p>
        ) : null}
      </section>

      <section className={panel.panel} aria-labelledby="notice-title">
        <h2 id="notice-title" className={panel.panelTitle}>Notice</h2>
        <Field id="notice-days" label="Days of notice" type="number" value={notice} onChange={setNotice} hint="How many days ahead customers must order. 0 means same day." />
      </section>

      {error ? <Callout tone="error">{error}</Callout> : null}
      {done && !error ? <Callout tone="info">Saved.</Callout> : null}
      <div className={panel.buttons}>
        <Button type="submit" busy={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}
