'use client';

import { useCallback, useEffect, useState } from 'react';
import { browserPushClient, isInstalled, type PushClient } from '../../../lib/push-client.js';
import { PeekTile } from './new-version.js';
import styles from './push-prompt.module.css';
import { Callout } from '@curios/ui';

/** localStorage: when the owner last said "Not now" (ms since epoch). */
export const PUSH_DISMISSED_AT_KEY = 'curios:push-prompt-dismissed-at';
/** "Not now" holds the card back this long. */
export const PUSH_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
/** The success line stays this long. */
export const PUSH_DONE_MS = 3000;

const FAILED = 'Couldn’t turn on notifications. Try again, or use Settings → Notifications.';

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(PUSH_DISMISSED_AT_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < PUSH_DISMISS_MS;
  } catch {
    return false;
  }
}

type State = { kind: 'none' } | { kind: 'ask'; publicKey: string } | { kind: 'done' };

/**
 * "Get a buzz for new orders on this phone?": one tap, then the browser's own Allow prompt. Only in the
 * installed app (never a browser tab), only while permission is still undecided, and a "Not now" keeps it
 * away for 14 days. Nothing is fetched until the checks that need no network pass. `held` queues it
 * behind the new-version card (and the install card, which only shows outside the installed app).
 * `client` and `installed` default to the real browser; tests pass fakes.
 */
export function PushPrompt({
  held = false,
  client = browserPushClient,
  installed = isInstalled,
}: {
  held?: boolean;
  client?: PushClient;
  installed?: () => boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      if (!installed() || client.support() !== 'ok' || dismissedRecently()) return;
      if (client.permission() === 'denied') return;
      const publicKey = await client.publicKey().catch(() => null);
      if (!publicKey || !live) return;
      if ((await client.current().catch(() => 'error')) !== null) return;
      if (live) setState({ kind: 'ask', publicKey });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, installed]);

  useEffect(() => {
    if (state.kind !== 'done') return;
    const timer = setTimeout(() => setState({ kind: 'none' }), PUSH_DONE_MS);
    return () => clearTimeout(timer);
  }, [state.kind]);

  const remember = useCallback(() => {
    try {
      window.localStorage.setItem(PUSH_DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // Blocked storage: the card may return on the next visit, which is harmless.
    }
  }, []);

  const dismiss = useCallback(() => {
    remember();
    setState({ kind: 'none' });
  }, [remember]);

  // Called straight from the tap: iOS only lets requestPermission run from a user gesture.
  async function turnOn(publicKey: string) {
    setError('');
    setBusy(true);
    try {
      const result = await client.turnOn(publicKey);
      // Closing the browser's prompt leaves permission at "default": that is a Not now, so hold the card back
      // (Chrome on Android blocks a site after a few dismissals). A real "denied" hides it for good.
      if (result !== 'on' && client.permission() === 'default') remember();
      setState(result === 'on' ? { kind: 'done' } : { kind: 'none' });
    } catch (failure) {
      console.error('Turning on notifications failed', failure);
      // Subscribed in the browser but not saved on the server? Undo it, so the card can offer again.
      await client.turnOff().catch(() => undefined);
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.slot} role="status" aria-live="polite">
      {state.kind === 'done' ? (
        <div className={styles.card} data-push-prompt="done">
          <PeekTile />
          <div className={styles.words}>
            <p className={styles.title}>Notifications are on for this phone.</p>
          </div>
        </div>
      ) : null}
      {state.kind === 'ask' && !held ? (
        <div className={styles.card} data-push-prompt="ask">
          <PeekTile />
          <div className={styles.words}>
            <p className={styles.title}>Get a buzz for new orders on this phone?</p>
            <p className={styles.sub}>New orders, receipts and leads, the moment they come in.</p>
            {error ? <Callout tone="error">{error}</Callout> : null}
          </div>
          <button type="button" className={styles.turnOn} disabled={busy} onClick={() => void turnOn(state.publicKey)}>
            {error ? 'Try again' : 'Turn on'}
          </button>
          <button type="button" className={styles.dismiss} aria-label="Not now" onClick={dismiss}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
