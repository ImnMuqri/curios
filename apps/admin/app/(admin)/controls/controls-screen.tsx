'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ringgit } from '@curios/core/money';
import { BANNER_MAX, PRICE_MAX_RM, type Settings, type SwitchKey } from '@curios/core/settings';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { ReasonDialog } from '../reason-dialog.js';
import { said } from '../said.js';
import { lowerFirst, SWITCHES } from './switches.js';
import styles from './controls.module.css';

type LimitField = 'cap' | 'freeLeads' | 'freeOrders' | 'monthlyRm' | 'yearlyRm';

/** The board's five inputs: label, subline, unit, and the range the API accepts. */
const LIMITS: { key: LimitField; title: string; subline: string; unit: string; min: number; max: number; rm?: true }[] = [
  { key: 'cap', title: 'Conversations a month, per page', subline: 'Then the fixed reply until the 1st', unit: 'conversations', min: 1, max: 100000 },
  { key: 'freeLeads', title: 'Free leads on a trial', subline: 'Numbers before the capture card stops', unit: 'leads', min: 1, max: 1000 },
  { key: 'freeOrders', title: 'Free orders on a trial', subline: 'Before checkout pauses', unit: 'orders', min: 1, max: 1000 },
  { key: 'monthlyRm', title: 'Business, monthly', subline: 'Charged through CHIP', unit: 'RM', min: 1, max: PRICE_MAX_RM * 10, rm: true },
  { key: 'yearlyRm', title: 'Business, yearly', subline: 'Charged through CHIP', unit: 'RM', min: 1, max: PRICE_MAX_RM * 10, rm: true },
];

type Values = Record<LimitField, string>;

/** A price in RM as the input shows it: 49, or 49.50 for a stored price with sen (Controls saves whole RM only). */
const rmField = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** What the server holds now, as the inputs show it: prices in RM, with sen only when stored with sen. */
function savedValues(s: Settings): Values {
  return {
    cap: String(s.cap),
    freeLeads: String(s.freeLeads),
    freeOrders: String(s.freeOrders),
    monthlyRm: rmField(s.prices.MONTHLY),
    yearlyRm: rmField(s.prices.ANNUAL),
  };
}

/** Whole numbers in range. A stored price with sen is also fine while it is left as it is: it is never sent. */
const validField = (l: (typeof LIMITS)[number], v: string, stored: string) =>
  (v === stored && stored.includes('.')) || (/^\d+$/.test(v) && Number(v) >= l.min && Number(v) <= l.max);
const show = (l: (typeof LIMITS)[number], v: string) => (l.rm ? `RM${v}` : v);

/** Shown in place of the form when the stored settings can't be read: no switches, limits or banner. */
export function ControlsUnavailable() {
  return (
    <>
      <div className={styles.head}>
        <h1>Controls</h1>
        <p>Switches and limits for the whole of Curios</p>
      </div>
      <div className={styles.body}>
        <p className={styles.err} role="alert">
          Couldn&apos;t load the current settings. Reload to try again.
        </p>
      </div>
    </>
  );
}

export function ControlsScreen({ settings }: { settings: Settings }) {
  const router = useRouter();
  const saved = savedValues(settings);
  const [values, setValues] = useState<Values>(saved);
  const [banner, setBanner] = useState(settings.banner ?? '');
  // A refresh that brings a different stored banner (another admin's, or ours) re-seeds the box.
  useEffect(() => setBanner(settings.banner ?? ''), [settings.banner]);
  const [turningOff, setTurningOff] = useState<SwitchKey | null>(null);
  const [saving, setSaving] = useState(false);
  /** After a 409 BIG_CHANGE: the reason already given, and the prices the API named. */
  const [big, setBig] = useState<{ reason: string; fields: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const changed = LIMITS.filter((l) => values[l.key] !== saved[l.key]);
  const valid = LIMITS.every((l) => validField(l, values[l.key], saved[l.key]));
  const dirty = changed.length > 0;
  const live = settings.banner !== null;

  /** One change to a setting; refreshes the screen's data and says it in a toast. */
  async function put(path: string, payload: Record<string, unknown>, done: string) {
    await apiFetch(path, { method: 'PUT', body: JSON.stringify(payload) }).catch((e: unknown) => {
      // The API says the screen is out of date (already off, nothing different): fetch what is
      // really stored, and keep the API's message on show.
      if (e instanceof ApiError && (e.code === 'SWITCH_STATE' || e.code === 'NO_CHANGE')) router.refresh();
      throw said(e);
    });
    router.refresh();
    setToast(done);
  }

  async function flip(key: SwitchKey, title: string) {
    setError(null);
    setBusy(true);
    try {
      await put(`/admin/settings/switches/${key}`, { on: true }, `${title} on.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(key: SwitchKey, title: string, reason: string) {
    await put(`/admin/settings/switches/${key}`, { on: false, reason }, key === 'chat' ? 'Chat answers are off everywhere.' : `${title} off.`);
    setTurningOff(null);
  }

  async function publish(text: string | null) {
    setError(null);
    setBusy(true);
    try {
      await put('/admin/settings/banner', { text }, text === null ? 'Banner taken down.' : 'Banner is showing on every dashboard.');
      if (text === null) setBanner('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Only what the admin changed: a value another admin saved since this page loaded is left alone.
  const limitsBody = (reason: string, confirmBig: boolean) => ({
    ...Object.fromEntries(changed.map((l) => [l.key, Number(values[l.key])])),
    reason,
    ...(confirmBig ? { confirmBig: true } : {}),
  });

  async function saveLimits(reason: string) {
    try {
      await put('/admin/settings/limits', limitsBody(reason, false), 'Saved for every page.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'BIG_CHANGE') {
        // The first dialog hands over to the second, which already has the reason.
        setSaving(false);
        setBig({ reason, fields: e.fields });
        return;
      }
      throw e;
    }
    setSaving(false);
  }

  async function saveAnyway() {
    if (!big) return;
    setError(null);
    setBusy(true);
    try {
      await put('/admin/settings/limits', limitsBody(big.reason, true), 'Saved for every page.');
      setBig(null);
    } catch (e) {
      setBig(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Old → new for each changed value; with `only`, just the prices the API called big. */
  const list = (only?: string[]) => {
    const rows = changed.filter((l) => !only || only.length === 0 || !l.rm || only.includes(l.key === 'monthlyRm' ? 'monthly' : 'yearly'));
    return (
      <ul className={styles.changes}>
        {rows.map((l) => (
          <li key={l.key}>
            {l.title}: <b>{`${show(l, saved[l.key])} → ${show(l, values[l.key])}`}</b>
          </li>
        ))}
      </ul>
    );
  };

  const asking = SWITCHES.find((s) => s.key === turningOff);

  return (
    <>
      <div className={styles.head}>
        <h1>Controls</h1>
        <p>Switches and limits for the whole of Curios</p>
      </div>

      <div className={styles.body}>
        {error && (
          <p className={styles.err} role="alert">
            {error}
          </p>
        )}
        <div className={styles.grid}>
          <div className={styles.sec}>
            <h2 className={styles.h2}>
              Switches<span>Take effect within a minute</span>
            </h2>
            <ul className={`${styles.box} ${styles.rows}`}>
              {SWITCHES.map((s) => {
                const on = settings.switches[s.key];
                return (
                  <li key={s.key} className={styles.ctl}>
                    <span>
                      <b>{s.title}</b>
                      <small>{s.subline}</small>
                    </span>
                    <button
                      type="button"
                      className={styles.sw}
                      role="switch"
                      aria-checked={on}
                      aria-label={s.title}
                      disabled={busy}
                      onClick={() => (on ? setTurningOff(s.key) : void flip(s.key, s.title))}
                    >
                      <i />
                    </button>
                  </li>
                );
              })}
            </ul>

            <h2 className={`${styles.h2} ${styles.again}`}>Banner on every owner&apos;s dashboard</h2>
            <div className={`${styles.box} ${styles.pad}`}>
              <textarea
                className={styles.text}
                aria-label="Banner text"
                value={banner}
                maxLength={BANNER_MAX}
                placeholder="E.g. Payments are slow this morning. Orders still come through."
                onChange={(e) => setBanner(e.target.value.slice(0, BANNER_MAX))}
              />
              <div className={styles.save}>
                <button type="button" className={styles.prim} disabled={busy || !banner.trim() || banner.trim() === settings.banner} onClick={() => void publish(banner.trim())}>
                  {live ? 'Update banner' : 'Show banner'}
                </button>
                {live && (
                  <>
                    <button type="button" className={styles.ghost} disabled={busy} onClick={() => void publish(null)}>
                      Take it down
                    </button>
                    <span className={styles.live}>
                      <i />
                      Showing now
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={styles.sec}>
            <h2 className={styles.h2}>
              Limits and prices<span>For every page</span>
            </h2>
            <ul className={`${styles.box} ${styles.rows}`}>
              {LIMITS.map((l) => (
                <li key={l.key} className={styles.ctl}>
                  <span>
                    <b>{l.title}</b>
                    <small>{l.subline}</small>
                    {l.rm && saved[l.key].includes('.') && <small>Stored as {ringgit(Math.round(Number(saved[l.key]) * 100))}; saving rounds to whole RM</small>}
                  </span>
                  <span className={styles.in}>
                    <input
                      inputMode="numeric"
                      aria-label={l.title}
                      aria-invalid={!validField(l, values[l.key], saved[l.key])}
                      value={values[l.key]}
                      // Editing a price shown with sen starts from its whole ringgit: "49.5" must not become 495.
                      onChange={(e) => setValues({ ...values, [l.key]: (values[l.key].includes('.') ? e.target.value.split('.')[0]! : e.target.value).replace(/[^0-9]/g, '') })}
                    />
                    <span>{l.unit}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.save}>
              <button type="button" className={styles.prim} disabled={!dirty || !valid || busy} onClick={() => setSaving(true)}>
                Save changes
              </button>
              {dirty && (
                <>
                  <button type="button" className={styles.ghost} onClick={() => setValues(saved)}>
                    Undo
                  </button>
                  <span className={styles.dirty}>Not saved yet</span>
                </>
              )}
            </div>
            <p className={styles.note}>Price changes apply to the next payment. Anyone already paid keeps what they paid for.</p>
          </div>
        </div>
      </div>

      {asking &&
        (asking.key === 'chat' ? (
          <ReasonDialog
            title="Turn off chat answers for everyone?"
            text="Every page switches to the short fixed reply straight away."
            confirmLabel="Turn it off"
            placeholder="E.g. Model provider outage"
            danger
            onConfirm={(reason) => turnOff(asking.key, asking.title, reason)}
            onClose={() => setTurningOff(null)}
          />
        ) : (
          <ReasonDialog
            title={`Turn off ${lowerFirst(asking.title)}?`}
            text={asking.subline}
            confirmLabel="Turn it off"
            placeholder="E.g. The provider is down"
            onConfirm={(reason) => turnOff(asking.key, asking.title, reason)}
            onClose={() => setTurningOff(null)}
          />
        ))}
      {saving && (
        <ReasonDialog
          title="Save new limits and prices?"
          text="This changes every page on Curios. Prices apply from each owner’s next payment."
          confirmLabel="Save for everyone"
          placeholder="E.g. Raising the cap after the model price drop"
          details={list()}
          onConfirm={saveLimits}
          onClose={() => setSaving(false)}
        />
      )}
      {big && (
        <ReasonDialog
          title="That's a big change. Save it anyway?"
          text={`A price moves by more than half, or goes above RM${PRICE_MAX_RM}. It applies from each owner’s next payment.`}
          confirmLabel="Save anyway"
          reasonless
          details={list(big.fields)}
          onConfirm={saveAnyway}
          onClose={() => setBig(null)}
        />
      )}

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
