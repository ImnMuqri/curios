'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isInstalled } from '../../../lib/push-client.js';
import { PeekTile } from './new-version.js';
import styles from './install-prompt.module.css';

/** localStorage: how many full loads of the dashboard this browser has made. */
export const VISITS_KEY = 'curios:install-visits';
/** localStorage: when the owner last dismissed the card (ms since epoch). */
export const DISMISSED_AT_KEY = 'curios:install-dismissed-at';
/** localStorage: set once Curios was installed from the card (or the browser said so). */
export const INSTALLED_KEY = 'curios:installed';
/** A dismissal holds the card back this long. */
export const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
/** On the first visit the card waits this long; from the second visit it shows at once. */
export const FIRST_VISIT_WAIT_MS = 30_000;

/** Chrome's and Edge's install event, which TypeScript's DOM lib does not know. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the card may return on the next visit, which is harmless.
  }
}

/** Held back by a dismissal under 30 days old, or an install already made. */
function silenced(): boolean {
  if (read(INSTALLED_KEY)) return true;
  const at = Number(read(DISMISSED_AT_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
}

/** A phone or tablet: a touch screen is the main pointer. */
function onTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}

/** Other iOS browsers and in-app browsers, where Share may not offer Add to Home Screen. */
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\/|GSA\/|TikTok|musical_ly|BytedanceWebview|DuckDuckGo/;

/** Chrome's early catch (the inline script in the root layout), set before this component mounted. */
type InstallGlobals = Window & { __curiosInstall?: InstallEvent | null; __curiosInstalled?: boolean };

/** Real Safari on an iPhone or iPad (it has no install event; Add to Home Screen is in the Share sheet). */
function onIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Version\/[\d.]+.*Safari\//.test(ua) && !NOT_SAFARI.test(ua);
}

/**
 * "Put Curios on your phone": the new-version card's twin, for a signed-in owner on a phone who has not
 * installed Curios. Android (Chrome, Edge) gets an Install button that opens the browser's own prompt;
 * Safari on iPhone and iPad gets the Share hint and only a dismiss (it has no install API); any other
 * browser gets nothing. It waits for the second visit or 30 seconds of the first, never shows over the
 * new-version card (`held`), and a dismissal keeps it away for 30 days.
 *
 * The live region is in the page from the start and only its card comes and goes (read once, politely).
 */
export function InstallPrompt({ held = false }: { held?: boolean }) {
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const stashed = useRef<InstallEvent | null>(null);
  const [haveEvent, setHaveEvent] = useState(false);

  useEffect(() => {
    const early = window as InstallGlobals;
    if (early.__curiosInstalled) write(INSTALLED_KEY, '1');
    if (isInstalled() || silenced() || !onTouchDevice()) return;

    // One visit per full load (this component lives as long as the frame does).
    const visits = (Number(read(VISITS_KEY)) || 0) + 1;
    write(VISITS_KEY, String(visits));
    const timer = visits >= 2 ? undefined : setTimeout(() => setReady(true), FIRST_VISIT_WAIT_MS);
    if (visits >= 2) setReady(true);

    const onBefore = (event: Event) => {
      event.preventDefault();
      stashed.current = event as InstallEvent;
      setHaveEvent(true);
      setPlatform('android');
    };
    const onInstalled = () => {
      write(INSTALLED_KEY, '1');
      stashed.current = null;
      (window as InstallGlobals).__curiosInstall = null;
      setHidden(true);
    };
    // The event may have come before this mounted: the root layout's script kept it.
    if (early.__curiosInstall) onBefore(early.__curiosInstall);
    window.addEventListener('beforeinstallprompt', onBefore);
    window.addEventListener('appinstalled', onInstalled);
    if (onIosSafari()) setPlatform('ios');
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    write(DISMISSED_AT_KEY, String(Date.now()));
    setHidden(true);
  }, []);

  const install = useCallback(async () => {
    const event = stashed.current;
    if (!event) return;
    // The event works once, whatever the answer.
    stashed.current = null;
    (window as InstallGlobals).__curiosInstall = null;
    setHaveEvent(false);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') write(INSTALLED_KEY, '1');
      else write(DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // The browser refused to prompt: nothing to keep.
    }
    setHidden(true);
  }, []);

  const show = ready && !hidden && !held && (platform === 'ios' || (platform === 'android' && haveEvent));

  return (
    <div className={styles.slot} role="status" aria-live="polite">
      {show ? (
        <div className={styles.card} data-install-prompt={platform}>
          <PeekTile />
          <div className={styles.words}>
            {platform === 'ios' ? (
              <>
                <p className={styles.title}>Put Curios on your Home Screen</p>
                <p className={styles.sub}>
                  Tap Share
                  <svg className={styles.share} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
                  </svg>
                  , then Add to Home Screen.
                </p>
              </>
            ) : (
              <>
                <p className={styles.title}>Put Curios on your phone</p>
                <p className={styles.sub}>Open it from your home screen, like an app.</p>
              </>
            )}
          </div>
          {platform === 'android' ? (
            <button type="button" className={styles.install} onClick={() => void install()}>
              Install
            </button>
          ) : null}
          <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={dismiss}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
