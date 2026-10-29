'use client';

import { useRef, useState } from 'react';
import { Callout } from '@curios/ui';
import { BANK_ACCOUNT_NAME_MAX, BANK_NAME_MAX } from '@curios/core/store';
import { ApiError } from '../../../lib/api.js';
import { relativeTime } from '../_ui/relative-time.js';
import ui from '../_ui/editor.module.css';
import { SaveState } from '../_ui/save-state.js';
import { SectionHead } from '../_ui/section-head.js';
import { orNull, useSettingText } from './setting-field.js';
import type { ChipApi, ChipState, SettingsPatch, StoreSettings } from './store-types.js';
import styles from './store.module.css';

/** The banks most owners here use, one tap each; anything else is typed. */
const BANKS = ['Maybank', 'CIMB', 'Public Bank', 'RHB', 'Bank Islam', 'Hong Leong'];

const NOT_CONNECTED: ChipState = { connected: false, brandName: null, methods: [], checkedAt: null, isTest: false };

/** Where CHIP's own sign-up starts. */
const CHIP_SIGN_UP = 'https://www.chip-in.asia';

/**
 * The API replaces a 5xx message with a generic sentence and keeps only an allow-listed
 * code, so an outage and "switched off here" are told by code. Anything below 500 carries
 * a message written for the owner, used as it is.
 */
function chipError(failure: unknown): string {
  if (failure instanceof ApiError && failure.code === 'CHIP_UNAVAILABLE') return 'CHIP is not answering right now. Try again in a few minutes.';
  if (failure instanceof ApiError && failure.code === 'CHIP_NOT_CONFIGURED') return 'Connecting CHIP is switched off here: no PAYMENT_SECRETS_KEY in this environment.';
  return failure instanceof Error && failure.message ? failure.message : 'That did not work. Try again.';
}

/**
 * "Online payments" (Store board): the owner's own CHIP account. Not connected, it
 * says what CHIP does; connecting, it asks for the Brand ID and secret key; connected,
 * it names the brand and offers the RM1 test and Disconnect. The secret key is only
 * ever typed here and sent once; it is never read back, and is cleared once sent.
 */
function OnlinePayments({
  chip,
  chipApi,
  onChip,
  displayName,
  now,
  navigate,
}: {
  chip: ChipState;
  chipApi: ChipApi;
  onChip: (chip: ChipState) => void;
  displayName: string;
  now: Date;
  navigate: (url: string) => void;
}) {
  const [form, setForm] = useState(false);
  const [brandId, setBrandId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      setError(chipError(failure));
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run(async () => {
      const next = await chipApi.connect(brandId, secretKey);
      setSecretKey('');
      setBrandId('');
      setForm(false);
      onChip(next);
    });

  const disconnect = () =>
    run(async () => {
      setConfirming(false);
      await chipApi.disconnect();
      onChip(NOT_CONNECTED);
    });

  const test = () => run(async () => navigate(await chipApi.test()));

  const checked = chip.checkedAt ? relativeTime(new Date(chip.checkedAt), now) : 'just now';

  return (
    <section className={ui.section} aria-labelledby="online-title">
      <SectionHead id="online-title" title="Online payments" note="FPX, e-wallets and cards through your own CHIP account. Orders mark themselves paid." />
      {chip.connected ? (
        <div className={`${styles.gw} ${styles.gwOn}`}>
          <span className={styles.gwOk} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          {/* One row (v3): what is connected on the left, its buttons on the right (under it on a phone). */}
          <span className={styles.gwText}>
            <span className={styles.rowCopy}>
              <b>Connected to CHIP</b>
              <p>
                Brand “{chip.brandName ?? displayName}” · checked {checked}. Customers can pay by FPX, e-wallet or card, and those orders land in Orders as Paid. Your
                DuitNow QR below stays on too, with receipts to check as before.
              </p>
              {chip.isTest ? <p>Test mode: payments here move no real money.</p> : null}
            </span>
            {confirming ? (
              <span className={ui.confirm}>
                Disconnect CHIP? Customers can’t pay online until you connect again.
                <button type="button" className={ui.confirmRemove} onClick={() => void disconnect()}>
                  Yes, disconnect
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <span className={styles.buttons}>
                <button type="button" className={styles.outline} disabled={busy} onClick={() => void test()}>
                  Test with RM1
                </button>
                <button type="button" className={styles.outline} data-disconnect="" disabled={busy} onClick={() => setConfirming(true)}>
                  Disconnect
                </button>
              </span>
            )}
          </span>
        </div>
      ) : form ? (
        <div className={styles.gw}>
          <b>Connect CHIP</b>
          <p>Copy these from your CHIP dashboard, under Developers. We only use them to take payments for your orders.</p>
          <div className={`${styles.grid2} ${styles.gwForm}`}>
            <label className={`${ui.float} ${styles.mono}`}>
              <em>Brand ID</em>
              <input value={brandId} autoComplete="off" spellCheck={false} onChange={(event) => setBrandId(event.target.value)} />
            </label>
            <label className={`${ui.float} ${styles.mono}`}>
              <em>Secret key</em>
              <input value={secretKey} autoComplete="off" spellCheck={false} onChange={(event) => setSecretKey(event.target.value)} />
            </label>
          </div>
          <span className={`${styles.buttons} ${styles.gwButtons}`}>
            <button type="button" className={styles.filled} disabled={busy} onClick={() => void connect()}>
              Check and connect
            </button>
            <button
              type="button"
              className={styles.outline}
              onClick={() => {
                setForm(false);
                setSecretKey('');
                setError('');
              }}
            >
              Cancel
            </button>
          </span>
        </div>
      ) : (
        <div className={styles.gw}>
          <div className={styles.gwMarks} aria-hidden="true">
            <i className={styles.markFpx}>FPX</i>
            <i className={styles.markTng}>TNG</i>
            <i className={styles.markGrab}>Grab</i>
            <i className={styles.markCard}>Card</i>
          </div>
          <b>Let customers pay online</b>
          <p>Connect your own CHIP account. Customers pick their bank or e-wallet at checkout, and the order marks itself paid. No receipts to check.</p>
          <ul className={styles.gwList}>
            <li>Money goes to your CHIP account, then to your bank</li>
            <li>CHIP charges a small fee per payment</li>
            <li>Covers FPX, e-wallets and cards, all confirmed straight away</li>
            <li>Your DuitNow QR below stays on, with no CHIP fee</li>
          </ul>
          <span className={styles.buttons}>
            <button type="button" className={styles.filled} onClick={() => setForm(true)}>
              Connect CHIP
            </button>
            <a className={`${styles.outline} ${styles.signUp}`} href={CHIP_SIGN_UP} target="_blank" rel="noreferrer">
              No account yet? Sign up
            </a>
          </span>
        </div>
      )}
      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}

/**
 * How customers pay: online through the owner's own CHIP account, a DuitNow QR, a bank account. The QR uploads
 * and is removed at once; the bank fields save as the owner pauses. Each
 * order page shows these to its customer with the order's total.
 */
export function PaymentTab({
  settings,
  save,
  qr,
  uploadsEnabled,
  uploadQr,
  removeQr,
  onQr,
  displayName,
  chip,
  chipApi,
  onChip,
  now,
  navigate = (url) => window.location.assign(url),
}: {
  /** The shop's name, for the QR card's "<name> · DuitNow." */
  displayName: string;
  settings: StoreSettings;
  save: (patch: SettingsPatch) => Promise<StoreSettings>;
  qr: { has: boolean; url: string | null };
  uploadsEnabled: boolean;
  uploadQr: (file: File) => Promise<string>;
  removeQr: () => Promise<void>;
  onQr: (qr: { has: boolean; url: string | null }) => void;
  chip: ChipState;
  chipApi: ChipApi;
  onChip: (chip: ChipState) => void;
  /** For "checked 12 min ago": the server's now on first render, so both renders agree. */
  now: Date;
  /** Where "Test with RM1" sends the browser; tests pass a spy. */
  navigate?: (url: string) => void;
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
      <OnlinePayments chip={chip} chipApi={chipApi} onChip={onChip} displayName={displayName} now={now} navigate={navigate} />

      <section className={ui.section} aria-labelledby="qr-title">
        <SectionHead id="qr-title" title="DuitNow QR" note="Customers scan it on their order page, with the exact total shown. No CHIP fee." />
        {qr.has ? (
          <div className={styles.qrCard}>
            <span className={styles.qrBox}>
              {qr.url && !qrFailed ? <img src={qr.url} alt="Your DuitNow QR" onError={() => setQrFailed(true)} /> : null}
              <span className={styles.scan} aria-hidden="true" />
            </span>
            {/* One row (v3): a small QR, what it is, and its buttons on the right. */}
            <span className={styles.qrText}>
              <span className={styles.rowCopy}>
                <b>Your QR is ready</b>
                <p>{displayName} · DuitNow. Each order page shows it with the exact total, so customers pay the right amount.</p>
              </span>
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
        <SectionHead id="bank-title" title="Bank account" note={bankOk ? 'All three filled in' : 'Fill in all three to use it'} />
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
