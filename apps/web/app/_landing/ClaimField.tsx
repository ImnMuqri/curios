'use client';

import type { FormEvent } from 'react';
import { HANDLE_TYPED_EVENT, rememberWantedHandle, tidyHandle } from '../../lib/wanted-handle.js';
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

  // Tell the demo page beside the field, so it shows this address as it is typed.
  function echo(value: string) {
    window.dispatchEvent(new CustomEvent(HANDLE_TYPED_EVENT, { detail: tidyHandle(value) }));
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
          onChange={(event) => echo(event.currentTarget.value)}
        />
      </div>
      <button type="submit" className={`${base.button} ${styles.button}`}>
        {button}
      </button>
    </form>
  );
}
