import type { ReactNode } from 'react';
import styles from './Button.module.css';

/**
 * type defaults to "button", not to HTML's "submit".
 *
 * Every screen on this surface has at least one secondary control sitting
 * inside a form, and the HTML default turns each of those into a submit by
 * accident. Opting in to submit is one word; opting out of it is a bug nobody
 * finds until someone presses Cancel and the form posts.
 */
export function Button({
  children,
  type = 'button',
  variant = 'primary',
  busy = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}`}
      disabled={busy || disabled}
      // Only when busy. Disabled on its own says "you cannot press this" and
      // not "because it is working", which is the difference between a broken
      // button and a slow one to someone who cannot see it change.
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
