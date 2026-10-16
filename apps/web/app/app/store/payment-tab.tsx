'use client';

import { useRef, useState } from 'react';
import { Callout } from '@curios/ui';
import { BANK_ACCOUNT_NAME_MAX, BANK_NAME_MAX } from '@curios/core/store';
import ui from '../_ui/editor.module.css';
import { SaveState } from '../_ui/save-state.js';
import { SectionHead } from '../_ui/section-head.js';
import { orNull, useSettingText } from './setting-field.js';
import type { SettingsPatch, StoreSettings } from './store-types.js';
import styles from './store.module.css';

/** The banks most owners here use, one tap each; anything else is typed. */
const BANKS = ['Maybank', 'CIMB', 'Public Bank', 'RHB', 'Bank Islam', 'Hong Leong'];

/**
 * How customers pay: a DuitNow QR, a bank account, or both. The QR uploads
 * and is removed at once; the bank fields save as the owner pauses. Order
 * pages, which will show these to customers with each order's total, are
 * slice 18 -- so the words here say "will", not "does".
 */
export function PaymentTab({
  settings,
  save,
  qr,
  uploadsEnabled,
  uploadQr,
  removeQr,
  onQr,
}: {
  settings: StoreSettings;
  save: (patch: SettingsPatch) => Promise<StoreSettings>;
  qr: { has: boolean; url: string | null };
  uploadsEnabled: boolean;
  uploadQr: (file: File) => Promise<string>;
  removeQr: () => Promise<void>;
  onQr: (qr: { has: boolean; url: string | null }) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [qrError, setQrError] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const bankName = useSettingText(settings.bankName ?? '', (text) => ({ bankName: orNull(text) }), save);
  const accountName = useSettingText(settings.bankAccountName ?? '', (text) => ({ bankAccountName: orNull(text) }), save);
  const accountNumber = useSettingText(settings.bankAccountNumber ?? '', (text) => ({ bankAccountNumber: orNull(text) }), save);
  const bankOk = Boolean(settings.bankName && settings.bankAccountName && settings.bankAccountNumber);

  async function upload(picked: File) {
    setQrError('');
    try {
      const url = await uploadQr(picked);
      setQrFailed(false);
      onQr({ has: true, url });
    } catch (failure) {
      setQrError(failure instanceof Error && failure.message ? failure.message : 'That picture could not be used.');
    }
  }

  async function remove() {
    setQrError('');
    try {
      await removeQr();
      onQr({ has: false, url: null });
    } catch (failure) {
      // The QR stays: the API refuses when it is an open shop's only way to pay.
      setQrError(failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');
    }
  }

  return (
    <>
      <section className={ui.section} aria-labelledby="qr-title">
        <SectionHead id="qr-title" icon="qr" tone="biru" title="DuitNow QR" note="For customers to scan when they pay" />
        {qr.has ? (
          <div className={styles.qrCard}>
            <span className={styles.qrBox}>
              {qr.url && !qrFailed ? <img src={qr.url} alt="Your DuitNow QR" onError={() => setQrFailed(true)} /> : null}
              <span className={styles.scan} aria-hidden="true" />
            </span>
            <span>
              <b>Your QR is saved</b>
              <p>Order pages will show it with the exact total, so customers pay the right amount.</p>
              <span className={styles.buttons}>
                <button type="button" className={styles.outline} disabled={!uploadsEnabled} onClick={() => file.current?.click()}>
                  Change QR
                </button>
                <button type="button" className={styles.outline} data-danger="" onClick={() => void remove()}>
                  Remove
                </button>
              </span>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className={styles.drop}
            disabled={!uploadsEnabled}
            title={uploadsEnabled ? undefined : 'Uploading pictures is switched off here'}
            onClick={() => file.current?.click()}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />
            </svg>
            <b>Upload your DuitNow QR</b>
            <small>{uploadsEnabled ? 'A screenshot from your bank app works. PNG, JPG or WebP.' : 'Uploading pictures is switched off here.'}</small>
          </button>
        )}
        {uploadsEnabled ? (
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            aria-label="QR file"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = '';
              if (picked) void upload(picked);
            }}
          />
        ) : null}
        {qrError ? <Callout tone="error">{qrError}</Callout> : null}
      </section>

      <section className={ui.section} aria-labelledby="bank-title">
        <SectionHead id="bank-title" icon="bank" tone="hijau" title="Bank account" note={bankOk ? 'All three filled in' : 'Fill in all three to use it'} />
        <div className={styles.banks} role="group" aria-label="Pick your bank">
          {BANKS.map((bank) => (
            <button key={bank} type="button" className={styles.bank} aria-pressed={bankName.text === bank} onClick={() => bankName.change(bank)}>
              {bank}
            </button>
          ))}
        </div>
        <div className={styles.grid2}>
          <div className={styles.wide}>
            <label className={ui.float}>
              <em>Bank name</em>
              <input value={bankName.text} maxLength={BANK_NAME_MAX} autoComplete="off" onChange={(event) => bankName.change(event.target.value)} />
            </label>
            <SaveState status={bankName.autosave.status} error={bankName.autosave.error} retry={bankName.autosave.retry} />
          </div>
          <div>
            <label className={ui.float}>
              <em>Account name</em>
              <input value={accountName.text} maxLength={BANK_ACCOUNT_NAME_MAX} autoComplete="off" onChange={(event) => accountName.change(event.target.value)} />
            </label>
            <SaveState status={accountName.autosave.status} error={accountName.autosave.error} retry={accountName.autosave.retry} />
          </div>
          <div>
            <label className={`${ui.float} ${styles.mono}`}>
              <em>Account number</em>
              <input value={accountNumber.text} inputMode="numeric" autoComplete="off" onChange={(event) => accountNumber.change(event.target.value)} />
            </label>
            <SaveState status={accountNumber.autosave.status} error={accountNumber.autosave.error} retry={accountNumber.autosave.retry} />
          </div>
        </div>
        <p className={styles.noteline}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          </svg>
          Money goes straight to you. Curios never holds it.
        </p>
      </section>
    </>
  );
}
