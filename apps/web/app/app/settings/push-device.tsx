'use client';

import { useEffect, useState } from 'react';
import { browserPushClient, type PushClient } from '../../../lib/push-client.js';
import { SettingRow } from './setting-row.js';
import styles from './settings.module.css';

type State =
  | { kind: 'loading' }
  /** Push is switched off on the server (no keys): the section says nothing at all. */
  | { kind: 'hidden' }
  | { kind: 'ios-install' }
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  | { kind: 'ready'; publicKey: string; on: boolean };

/**
 * Settings, "Notify this device": push notifications for new orders, receipts and leads on the
 * phone or computer the owner is holding. Its own switch, not the emails': it is about this
 * device, and an owner may want the buzz and not the email, or the other way round.
 */
export function PushDeviceForm({ client }: { client: PushClient }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const support = client.support();
      if (support !== 'ok') return setState({ kind: support });
      const publicKey = await client.publicKey().catch(() => null);
      if (!publicKey) return setState({ kind: 'hidden' });
      if (client.permission() === 'denied') return setState({ kind: 'denied' });
      const on = client.permission() === 'granted' && (await client.current()) !== null;
      return setState({ kind: 'ready', publicKey, on });
    })().then(
      () => undefined,
      () => live && setState({ kind: 'hidden' }),
    );
    return () => {
      live = false;
    };
  }, [client]);

  if (state.kind === 'loading' || state.kind === 'hidden') return null;

  if (state.kind === 'ios-install') {
    return (
      <SettingRow
        title="Notifications on this iPhone"
        note="On iPhone they work once Curios is on your Home Screen. In Safari, tap Share, then Add to Home Screen. Open Curios from there and come back here."
      />
    );
  }
  if (state.kind === 'unsupported') {
    return <SettingRow title="Notifications on this device" note="This browser can’t show notifications. Try Chrome or Safari, or Curios on your phone." />;
  }
  if (state.kind === 'denied') {
    return (
      <SettingRow
        title="Notifications on this device"
        note="Blocked for Curios in this browser’s settings. Allow notifications for curios.my there, then come back here."
      />
    );
  }

  const { on, publicKey } = state;

  async function change(next: boolean) {
    setError('');
    setTested(false);
    setBusy(true);
    try {
      if (next) {
        const result = await client.turnOn(publicKey);
        if (result === 'denied') return setState({ kind: 'denied' });
      } else {
        await client.turnOff();
      }
      setState({ kind: 'ready', publicKey, on: next });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setError('');
    setBusy(true);
    try {
      await client.test();
      setTested(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingRow
      title="Notifications on this device"
      note={on ? 'New orders, receipts and leads buzz this device, whatever the emails are set to.' : 'Off. Turn on to hear about new orders, receipts and leads here.'}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Notify this device"
          className={styles.switch}
          disabled={busy}
          onClick={() => void change(!on)}
        >
          <i />
        </button>
      }
      below={
        <>
          {on ? (
            <p className={styles.pushTest}>
              <button type="button" className={styles.btn2} disabled={busy} onClick={() => void test()}>
                Send a test
              </button>
              {tested ? <span role="status">Sent. It should arrive in a few seconds.</span> : null}
            </p>
          ) : null}
          {error ? (
            <p className={`${styles.error} ${styles.rowError}`} role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
    />
  );
}

/** Supplies the real browser client. A Server Component may not pass one. */
export function PushDevice() {
  return <PushDeviceForm client={browserPushClient} />;
}
