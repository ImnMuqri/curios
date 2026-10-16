'use client';

import { useState } from 'react';
import { Callout } from '@curios/ui';
import styles from './curios.module.css';

/**
 * The Shop tab, on or off. Opening it can be refused (no items yet, no way to
 * be paid): the API says why, and that is what shows. The switch only moves
 * once the change has saved, so it never shows a shop that is not open.
 */
export function ShopSwitch({
  open,
  itemCount,
  setOpen,
  onOpen,
}: {
  open: boolean;
  itemCount: number;
  setOpen: (open: boolean) => Promise<void>;
  onOpen: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await setOpen(!open);
      onOpen(!open);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-label="Shop tab">
      <div className={styles.shopRow}>
        <span className={styles.kind} data-kind="shop" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2" />
          </svg>
        </span>
        <span className={styles.shopText}>
          <b>Shop tab</b>
          <span>
            Sits next to Links and Ask · {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Show the Shop tab"
          className={styles.switch}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <i />
        </button>
      </div>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}
