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
  // A submit button has no `onClick` of its own to take away: the double
  // submit it must refuse comes from the browser's default action on
  // `type="submit"`, not from this prop, and several forms on this surface
  // (ClaimForm, AddPasswordForm among them) lean on the native `disabled`
  // attribute alone to refuse it -- they carry no re-entry guard of their
  // own. So a submit button still goes natively `disabled` while busy, same
  // as before.
  //
  // A plain button's protection is `onClick` disappearing below, so it does
  // not need the native attribute -- and skipping it matters here: a real
  // browser blurs the focused element the instant it goes natively disabled,
  // and the one moment a button goes busy is the moment right after someone
  // pressed it. `aria-disabled` still tells assistive tech and the stylesheet
  // it cannot be used, without moving focus away just as a failure is about
  // to render beside this same button.
  const nativeDisable = disabled || (busy && type === 'submit');
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}`}
      disabled={nativeDisable}
      aria-disabled={busy && !nativeDisable ? true : undefined}
      // Only when busy. Disabled on its own says "you cannot press this" and
      // not "because it is working", which is the difference between a broken
      // button and a slow one to someone who cannot see it change.
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
    >
      {children}
    </button>
  );
}
