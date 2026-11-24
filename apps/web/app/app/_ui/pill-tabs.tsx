'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './pill-tabs.module.css';

/**
 * Where a key moves the choice in a row of options (a tab list, a radio group): Right (and, with
 * `upDown`, Down) to the next, Left (Up) to the one before, both wrapping; Home and End to the ends.
 * Null for any other key. `at` is the chosen option's index (-1 when none is).
 */
export function rovingIndex(key: string, at: number, length: number, upDown = false): number | null {
  if (length === 0) return null;
  if (key === 'ArrowRight' || (upDown && key === 'ArrowDown')) return (at + 1) % length;
  if (key === 'ArrowLeft' || (upDown && key === 'ArrowUp')) return (at - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

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
  underline = false,
}: {
  label: string;
  tabs: readonly { id: Id; label: string; count?: ReactNode }[];
  selected: Id;
  onSelect: (id: Id) => void;
  /** The board's My Curios tabs: words on a hairline, the chosen one underlined, not pills. */
  underline?: boolean;
}) {
  const refs = useRef<Partial<Record<Id, HTMLButtonElement | null>>>({});
  const at = tabs.findIndex((t) => t.id === selected);

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = rovingIndex(event.key, at, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const id = tabs[next]!.id;
    onSelect(id);
    refs.current[id]?.focus();
  }

  return (
    <div className={underline ? styles.lineTrack : styles.track} role="tablist" aria-label={label}>
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
          className={underline ? styles.lineTab : styles.pill}
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
