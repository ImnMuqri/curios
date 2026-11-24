import type { ReactNode } from 'react';
import styles from '../auth.module.css';

/**
 * A 56px pill field from the Site board: its words are the placeholder, and its
 * label stays for a screen reader (visually hidden). `trailing` sits inside the
 * pill's end ("Forgot?", the show-password eye); `peek` is Peek, placed over it.
 * An error is tied to the field with `describedBy`, and `invalid` rings the pill.
 */
export function PillField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  required = false,
  minLength,
  describedBy,
  invalid = false,
  onFocus,
  onBlur,
  trailing,
  peek,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  describedBy?: string;
  invalid?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  trailing?: ReactNode;
  peek?: ReactNode;
}) {
  return (
    <div className={styles.w}>
      {peek}
      <div className={styles.pil} data-invalid={invalid ? '' : undefined}>
        <label htmlFor={id} className={styles.srOnly}>
          {label}
        </label>
        <input
          id={id}
          name={id}
          className={styles.in}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
        {trailing}
      </div>
    </div>
  );
}
