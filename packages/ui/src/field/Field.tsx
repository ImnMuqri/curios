'use client';

import { useId, useState, type ReactNode } from 'react';
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
 *
 * A password field carries its own show/hide toggle. Nobody can see a typo in
 * dots, and a password mistyped at signup is an account its owner cannot sign
 * in to -- which is exactly how the first real signup went.
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
  placeholder,
  labelAside,
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
  /** An example of the expected shape ("you@example.com"). Never a stand-in for the label. */
  placeholder?: string;
  /** Beside the label, at its far end: "Forgot your password?" on sign-in. */
  labelAside?: ReactNode;
}) {
  const hintId = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password' && !multiline;

  return (
    <div className={styles.field}>
      {labelAside ? (
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor={id}>
            {label}
          </label>
          {labelAside}
        </div>
      ) : (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
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
        <div className={isPassword ? styles.revealable : undefined}>
          <input
            id={id}
            type={isPassword && revealed ? 'text' : type}
            value={value}
            required={required}
            autoComplete={autoComplete}
            placeholder={placeholder}
            aria-describedby={hint ? hintId : undefined}
            className={styles.control}
            onChange={(event) => onChange(event.target.value)}
          />
          {isPassword ? (
            // type="button": inside a sign-in form, a default button would
            // submit a half-typed password. The accessible name is built from
            // text rather than aria-label, so looking the field up by its label
            // still finds only the input.
            <button
              type="button"
              className={styles.reveal}
              aria-controls={id}
              aria-pressed={revealed}
              onClick={() => setRevealed((shown) => !shown)}
            >
              {/* An eye, crossed out while the password shows; the words are for a screen reader. */}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
                {revealed ? <path d="M4 4l16 16" /> : null}
              </svg>
              <span className={styles.visuallyHidden}>{revealed ? 'Hide' : 'Show'} password</span>
            </button>
          ) : null}
        </div>
      )}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
