'use client';

import type { FormEvent } from 'react';
import { rememberWantedHandle } from '../../lib/wanted-handle.js';
import base from './landing.module.css';
import styles from './claim.module.css';

/**
 * The `curios.my/` field: type the address you want, then sign up. The handle
 * is kept in browser storage and pre-fills the claim screen after sign-up and
 * email verification (lib/wanted-handle.ts).
 *
 * A real GET form to /signup, so it still goes somewhere with no JavaScript;
 * it just arrives without the pre-fill.
 */
export function ClaimField({
  id,
  label,
  placeholder,
  button,
}: {
  id: string;
  label: string;
  placeholder: string;
  button: string;
}) {
  function remember(event: FormEvent<HTMLFormElement>) {
    const handle = new FormData(event.currentTarget).get('handle');
    rememberWantedHandle(typeof handle === 'string' ? handle : '');
  }

  return (
    <form className={styles.claim} action="/signup" method="get" onSubmit={remember}>
      <label htmlFor={id} className={base.srOnly}>
        {label}
      </label>
      <div className={styles.field}>
        <span className={styles.prefix} aria-hidden="true">
          curios.my/
        </span>
        <input
          id={id}
          name="handle"
          className={styles.input}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
        />
      </div>
      <button type="submit" className={`${base.button} ${styles.button}`}>
        {button}
      </button>
    </form>
  );
}
