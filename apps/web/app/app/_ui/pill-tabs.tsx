'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './pill-tabs.module.css';

/**
 * The dashboard's one tab style (Dashboard v2): a grey track with the chosen tab as a white pill,
 * no underline. Left and right move between them and choose, Home and End jump, as a tab list
 * does. Each tab controls `panel-{id}`. A tab's `count` is a small badge after its label.
 *
 * Tab rows that are links or filters rather than a tab list (Facts & sources, the inbox filters)
 * use the same stylesheet: `pill-tabs.module.css`, its `track`, `pill` and `count`.
 */
export function PillTabs<Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
}: {
  label: string;
  tabs: readonly { id: Id; label: string; count?: ReactNode }[];
  selected: Id;
  onSelect: (id: Id) => void;
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
    <div className={styles.track} role="tablist" aria-label={label}>
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
          className={styles.pill}
          onClick={() => onSelect(t.id)}
          onKeyDown={onKey}
        >
          {t.label}
          {t.count !== undefined ? <span className={styles.count}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
