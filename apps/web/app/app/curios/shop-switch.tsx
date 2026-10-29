'use client';

import { useState } from 'react';
import { Callout } from '@curios/ui';
import ui from '../_ui/editor.module.css';
import styles from './curios.module.css';

/**
 * The Shop link, on or off: the first row of the links list (v3 board), so it
 * reads as the link it is, always above the owner's own. Opening it can be refused (no items yet, no way to
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
    <>
      <div className={styles.shopRow} role="group" aria-label="Shop link">
        <span className={styles.linkKind} data-kind="shop" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" className={ui.toolIcon}>
            <path d="M4 9l1.5-5h13L20 9M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
          </svg>
        </span>
        <span className={styles.shopText}>
          <b>Shop link</b>
          <span>
            Always first in your links, {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Show the Shop link"
          className={ui.switch}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <i />
        </button>
      </div>
      {error ? <Callout tone="error">{error}</Callout> : null}
    </>
  );
}
