'use client';

import { useState } from 'react';
import { Callout } from '@curios/ui';
import { DELIVERY_FEE_MAX_CENTS, MIN_NOTICE_DAYS_MAX, PICKUP_NOTE_MAX, parseRinggit, type DeliveryMode } from '@curios/core/store';
import ui from '../_ui/editor.module.css';
import { SaveState } from '../_ui/save-state.js';
import { SectionHead } from '../_ui/section-head.js';
import { useAutosave } from '../_ui/use-autosave.js';
import { centsText } from './pricing.js';
import { orNull, useSettingText } from './setting-field.js';
import type { SettingsPatch, StoreSettings } from './store-types.js';
import styles from './store.module.css';

const FEE_SENTENCE = 'Give flat delivery a fee above RM0, up to RM500.';

const MODES: { mode: DeliveryMode; name: string; note: string; tone?: 'biru' | 'hijau'; d: string }[] = [
  { mode: 'NONE', name: 'No delivery', note: 'Pickup only', d: 'M5 5l14 14M9 7h5v6M14 10h4l3 3v3h-3M3 7h2M3 16h8M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
  { mode: 'FLAT', name: 'Flat fee', note: 'One fee per order', tone: 'biru', d: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
  { mode: 'RIDER', name: 'Rider paid separately', note: 'Customer pays the rider', tone: 'hijau', d: 'M5 17a3 3 0 1 0 0-.01M19 17a3 3 0 1 0 0-.01M5 17l4-7h5l3 7M9 10l-1-3H6M14 10l2-3h2' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const noticeWords = (days: number) => (days === 0 ? 'Same day' : days === 1 ? '1 day' : `${days} days`);

/** The fee to send for flat delivery, or the sentence to show while there is none that would be taken. */
function feePatch(text: string): SettingsPatch | { problem: string } {
  const cents = parseRinggit(text);
  if (cents === null || cents <= 0 || cents > DELIVERY_FEE_MAX_CENTS) return { problem: FEE_SENTENCE };
  return { deliveryMode: 'FLAT', deliveryFeeCents: cents };
}

/**
 * Pickup, delivery and notice. Switches and tiles save at once; the note and
 * the fee as the owner pauses. Flat delivery is only sent once it has a fee
 * the API will take, so choosing it first and typing the fee second works.
 * A change that would leave an open shop with no way to hand over is refused
 * by the API, and the choice goes back with its reason.
 */
export function DeliveryTab({
  settings,
  save,
  today,
}: {
  settings: StoreSettings;
  save: (patch: SettingsPatch) => Promise<StoreSettings>;
  /** Passed in so the strip of days is the same on the server and in the browser. */
  today: Date;
}) {
  const [mode, setMode] = useState(settings.deliveryMode);
  const [pickup, setPickup] = useState(settings.pickupEnabled);
  const [notice, setNotice] = useState(settings.minNoticeDays);
  const [error, setError] = useState('');
  const note = useSettingText(settings.pickupNote ?? '', (text) => ({ pickupNote: orNull(text) }), save);
  const fee = useSettingText(settings.deliveryFeeCents ? centsText(settings.deliveryFeeCents) : '', feePatch, save);
  // From the field as it reads now, so choosing flat delivery with no fee yet asks for one straight away.
  const feeCheck = feePatch(fee.text);
  const feeProblem = 'problem' in feeCheck ? feeCheck.problem : '';
  const noticeSave = useAutosave((days: number) => save({ minNoticeDays: days }), 300);

  async function choosePickup(next: boolean) {
    setError('');
    setPickup(next);
    try {
      await save({ pickupEnabled: next });
    } catch (failure) {
      setPickup(!next);
      setError(failure instanceof Error ? failure.message : 'That did not save. Try again.');
    }
  }

  async function chooseMode(next: DeliveryMode) {
    if (next === mode) return;
    const before = mode;
    setError('');
    setMode(next);
    let patch: SettingsPatch = { deliveryMode: next };
    if (next === 'FLAT') {
      const withFee = feePatch(fee.text);
      // No fee yet: the field asks for one, and the mode is sent with it.
      if ('problem' in withFee) return;
      patch = withFee;
    }
    try {
      await save(patch);
    } catch (failure) {
      setMode(before);
      setError(failure instanceof Error ? failure.message : 'That did not save. Try again.');
    }
  }

  function step(delta: 1 | -1) {
    const next = Math.min(MIN_NOTICE_DAYS_MAX, Math.max(0, notice + delta));
    setNotice(next);
    noticeSave.schedule(next);
  }

  const days = Array.from({ length: 10 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  const earliest = days[Math.min(notice, days.length - 1)] ?? today;
  const earliestWords =
    notice === 0
      ? 'Customers can order for today.'
      : notice < days.length
        ? `Ordering today, the earliest a customer can have it is ${WEEKDAYS[earliest.getDay()]} ${earliest.getDate()} ${MONTHS[earliest.getMonth()]}.`
        : `Customers order ${notice} days ahead.`;

  return (
    <>
      <section className={ui.section} aria-labelledby="pickup-title">
        <SectionHead id="pickup-title" icon="bag" tone="amber" title="Pickup" note="Customers collect from you" />
        <div className={styles.row}>
          <span className={styles.rowText}>
            <b>Allow pickup</b>
            <span>{pickup ? 'Your shop says where and when' : 'Customers can only get it delivered'}</span>
          </span>
          <button type="button" className={ui.switch} role="switch" aria-checked={pickup} aria-label="Allow pickup" onClick={() => void choosePickup(!pickup)}>
            <i />
          </button>
        </div>
        {pickup ? (
          <div className={`${ui.float} ${styles.pickupNote}`}>
            <label>
              <em>Where and when</em>
              <input value={note.text} maxLength={PICKUP_NOTE_MAX} autoComplete="off" onChange={(event) => note.change(event.target.value)} />
            </label>
            <small aria-hidden="true">
              {[...note.text].length}/{PICKUP_NOTE_MAX}
            </small>
          </div>
        ) : null}
        <SaveState status={note.autosave.status} error={note.autosave.error} retry={note.autosave.retry} />
      </section>

      <section className={ui.section} aria-labelledby="delivery-title">
        <SectionHead id="delivery-title" icon="truck" tone="hijau" title="Delivery" note="How orders reach customers who can't come" />
        <div className={styles.deliveryTiles} role="group" aria-labelledby="delivery-title">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={`${ui.tile} ${styles.deliveryTile}`}
              aria-pressed={mode === option.mode}
              onClick={() => void chooseMode(option.mode)}
            >
              <span className={ui.tick} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="12" height="12">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <span className={styles.deliveryIcon} data-tone={option.tone} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path d={option.d} />
                </svg>
              </span>
              <span>
                <b>{option.name}</b>
                <span>{option.note}</span>
              </span>
            </button>
          ))}
        </div>
        {mode === 'FLAT' ? (
          <div className={styles.fee}>
            <label className={styles.money}>
              <span>RM</span>
              <input value={fee.text} inputMode="decimal" aria-label="Delivery fee in ringgit" onChange={(event) => fee.change(event.target.value)} />
            </label>
            <span data-bad={feeProblem ? '' : undefined}>{feeProblem || 'Added to every delivery order'}</span>
          </div>
        ) : null}
        <SaveState status={fee.autosave.status} error={fee.autosave.error} retry={fee.autosave.retry} />
        {error ? <Callout tone="error">{error}</Callout> : null}
      </section>

      <section className={ui.section} aria-labelledby="notice-title">
        <SectionHead id="notice-title" icon="calendar" tone="rose" title="Notice" note="How far ahead customers must order" />
        <span className={styles.stepper}>
          <button type="button" aria-label="One day less" disabled={notice <= 0} onClick={() => step(-1)}>
            −
          </button>
          <output aria-live="polite">{noticeWords(notice)}</output>
          <button type="button" aria-label="One day more" disabled={notice >= MIN_NOTICE_DAYS_MAX} onClick={() => step(1)}>
            +
          </button>
        </span>
        <div className={styles.days} aria-hidden="true">
          {days.map((day, i) => (
            <span key={day.toISOString()} className={styles.day} data-when={i < notice ? 'before' : i === notice ? 'first' : undefined}>
              <span>{i === 0 ? 'Today' : WEEKDAYS[day.getDay()]}</span>
              <b>{day.getDate()}</b>
            </span>
          ))}
        </div>
        <p className={styles.noteline}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
          </svg>
          {earliestWords}
        </p>
        <SaveState status={noticeSave.status} error={noticeSave.error} retry={noticeSave.retry} />
      </section>
    </>
  );
}
