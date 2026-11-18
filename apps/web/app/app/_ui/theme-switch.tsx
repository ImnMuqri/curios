'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Theme } from '../theme.js';
import styles from './theme-switch.module.css';

/** The frame's theme and the way to change it. Null outside the frame: no switch there. */
export const ThemeContext = createContext<{ theme: Theme; choose: (theme: Theme) => void } | null>(null);

const DARK_DEVICE = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const device = window.matchMedia(DARK_DEVICE);
  device.addEventListener('change', onChange);
  return () => device.removeEventListener('change', onChange);
}

/** Whether the device asks for dark. False on the server, which cannot know; the client corrects it after hydrating. */
function useDeviceIsDark() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK_DEVICE).matches,
    () => false,
  );
}

/**
 * The account menu's Dark mode row (the calm Dash board): one switch, on when the frame is dark --
 * by the owner's choice, or by the device while nothing is chosen. Pressing it is an explicit
 * choice, Dark or Light, remembered from then on; following the device stays the default until then.
 */
export function DarkModeRow({ className }: { className?: string }) {
  const context = useContext(ThemeContext);
  const deviceIsDark = useDeviceIsDark();
  if (!context) return null;
  const dark = context.theme === 'dark' || (context.theme === 'system' && deviceIsDark);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      className={className ? `${styles.row} ${className}` : styles.row}
      onClick={() => context.choose(dark ? 'light' : 'dark')}
    >
      Dark mode
      <span className={styles.track} aria-hidden="true" />
    </button>
  );
}
