'use client';

import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import styles from './editor.module.css';

/**
 * The editing screens' tabs: a row of equal-width tabs with a biru underline
 * that slides to the chosen one. Left and right move between them and choose,
 * Home and End jump, as a tab list does. Each tab controls `panel-{id}`.
 */
export function UnderlineTabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
  width = 116,
}: {
  label: string;
  tabs: readonly { id: Id; label: string }[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** Each tab's width in px: 116 on My Curios, 150 on Store. */
  width?: number;
}) {
  const refs = useRef<Partial<Record<Id, HTMLButtonElement | null>>>({});
  const at = tabs.findIndex((t) => t.id === selected);

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next =
      event.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const id = tabs[next]!.id;
    onSelect(id);
    refs.current[id]?.focus();
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label={label} style={{ '--at': at, '--w': `${width}px` } as CSSProperties}>
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={selected === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={selected === t.id ? 0 : -1}
          className={styles.tab}
          onClick={() => onSelect(t.id)}
          onKeyDown={onKey}
        >
          {t.label}
        </button>
      ))}
      <span className={styles.underline} aria-hidden="true" />
    </div>
  );
}
