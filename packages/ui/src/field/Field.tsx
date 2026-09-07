import { useId } from 'react';
import styles from './Field.module.css';

/**
 * A label bound to its control, and a hint the control actually points at.
 *
 * `onChange` hands back the value, not the event. Every caller of this was
 * previously writing `(event) => setX(event.target.value)`, and the setter
 * itself is what they want.
 *
 * FRONTEND.md bans blank prompt boxes everywhere except a pinned answer and a
 * fact correction, so `multiline` exists for exactly one caller: the review
 * screen's claim editor.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required = false,
  hint,
  multiline = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  multiline?: boolean;
}) {
  const hintId = useId();

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          required={required}
          rows={3}
          // A hint nothing references is invisible to a screen reader, which
          // is the user most likely to need it.
          aria-describedby={hint ? hintId : undefined}
          className={styles.control}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          aria-describedby={hint ? hintId : undefined}
          className={styles.control}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
