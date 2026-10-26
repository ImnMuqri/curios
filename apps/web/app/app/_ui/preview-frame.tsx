'use client';

import type { CSSProperties, ReactNode } from 'react';
import styles from './editor.module.css';

/**
 * The live preview: a phone on a soft colour field, the page scrolling inside
 * it, and a row of tabs under it choosing what the phone shows. `overlay`
 * sits over the screen and stays put while the page scrolls (My Curios' ask
 * bar). Everything in the phone is the real renderer visitors see.
 */
export function PreviewFrame<Id extends string>({
  label,
  tabsLabel,
  tabs,
  selected,
  onSelect,
  overlay,
  children,
}: {
  label: string;
  tabsLabel: string;
  tabs: readonly { id: Id; label: string }[];
  selected: Id;
  onSelect: (id: Id) => void;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.preview} aria-label={label}>
      <div className={styles.phone}>
        <div className={styles.screen} data-island="">
          <div className={styles.scroll}>{children}</div>
          {overlay}
        </div>
      </div>
      <div
        className={styles.seg}
        role="tablist"
        aria-label={tabsLabel}
        style={{ '--n': tabs.length, '--at': tabs.findIndex((t) => t.id === selected) } as CSSProperties}
      >
        <span className={styles.segThumb} aria-hidden="true" />
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={selected === t.id} onClick={() => onSelect(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </section>
  );
}
