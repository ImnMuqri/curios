'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './settings.module.css';

/** Copies the page's address, and says so for a moment. Where the clipboard is refused, it says that instead. */
export function CopyAddress({ url, copy = (text: string) => navigator.clipboard.writeText(text) }: { url: string; copy?: (text: string) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    clearTimeout(timer.current);
    try {
      await copy(url);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 1600);
  }

  return (
    <button type="button" className={styles.btn2} onClick={() => void onClick()} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy it by hand' : 'Copy'}
    </button>
  );
}
