'use client';

import { createContext, useContext } from 'react';
import type { Theme } from '../theme.js';
import styles from './theme-switch.module.css';

/** The frame's theme and the way to change it. Null outside the frame: no switch there. */
export const ThemeContext = createContext<{ theme: Theme; choose: (theme: Theme) => void } | null>(null);

const OPTIONS: { theme: Theme; label: string; d: string }[] = [
  { theme: 'system', label: 'Match device', d: 'M4 5h16v11H4zM9 20h6M12 16v4' },
  { theme: 'light', label: 'Light', d: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4' },
  { theme: 'dark', label: 'Dark', d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' },
];

/** System, Light or Dark, at the end of every screen's header. */
export function ThemeSwitch({ className }: { className?: string }) {
  const context = useContext(ThemeContext);
  if (!context) return null;
  return (
    <div className={className ? `${styles.switch} ${className}` : styles.switch} role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.theme}
          type="button"
          className={styles.option}
          aria-label={option.label}
          title={option.label}
          aria-pressed={context.theme === option.theme}
          onClick={() => context.choose(option.theme)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d={option.d} />
          </svg>
        </button>
      ))}
    </div>
  );
}
