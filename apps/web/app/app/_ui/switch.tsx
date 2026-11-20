'use client';

import styles from './switch.module.css';

/**
 * The calm on/off switch: a native `<button role="switch" aria-checked>`, so Space and Enter work
 * for free, inside a 44px hit area around a 38x22 track. Controlled: the page owns `checked` and
 * flips it in `onChange(next)`. `label` is the accessible name (or pass `aria-labelledby`).
 *
 *   <Switch checked={on} onChange={setOn} label="Take orders" />
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  'aria-labelledby': labelledBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  'aria-labelledby'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={styles.hit}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}
