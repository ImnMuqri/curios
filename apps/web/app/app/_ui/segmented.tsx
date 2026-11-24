'use client';

import { useRef, type KeyboardEvent } from 'react';
import { rovingIndex } from './pill-tabs.js';
import styles from './pill-tabs.module.css';

/**
 * A short row of choices of which one holds (Small / Medium / Big): the dashboard's pill row
 * (`pill-tabs.module.css`), the chosen one the black pill. A radio group: one tab stop, on the chosen
 * one; the arrow keys move the choice and choose it, Home and End jump. Named by `label`, or by
 * `labelledBy` (the id of a visible label); a hint, if any, is the caller's to put beside it.
 *
 *   <Segmented label="Picture size" options={[{ id: 'a', label: 'A' }]} value={id} onChange={setId} />
 */
export function Segmented<Id extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  disabled,
}: {
  label?: string;
  labelledBy?: string;
  options: readonly { id: Id; label: string }[];
  value: Id;
  onChange: (id: Id) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Partial<Record<Id, HTMLButtonElement | null>>>({});
  const at = options.findIndex((option) => option.id === value);

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = rovingIndex(event.key, at, options.length, true);
    if (next === null) return;
    event.preventDefault();
    const id = options[next]!.id;
    if (id !== value) onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div className={styles.track} role="radiogroup" aria-label={label} aria-labelledby={labelledBy}>
      {options.map((option) => (
        <button
          key={option.id}
          ref={(el) => {
            refs.current[option.id] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          disabled={disabled}
          className={styles.pill}
          onClick={() => (value === option.id ? undefined : onChange(option.id))}
          onKeyDown={onKey}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
