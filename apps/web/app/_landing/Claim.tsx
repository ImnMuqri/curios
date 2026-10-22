'use client';

import type { FormEvent } from 'react';
import { rememberWantedHandle } from '../../lib/wanted-handle.js';
import { Peek } from '../_peek/Peek.js';
import styles from './tanya.module.css';

/**
 * The `curios.my/` field: type the address you want, then sign up. The handle
 * is kept in browser storage and pre-fills the claim screen after sign-up and
 * email verification (lib/wanted-handle.ts).
 *
 * A real GET form to /signup, so it still goes somewhere with no JavaScript;
 * it just arrives without the pre-fill.
 */
export function Claim({
  id,
  label,
  placeholder,
  button,
  variant = 'hero',
}: {
  id: string;
  label: string;
  placeholder: string;
  button: string;
  /** The hero's boxed field, or the closing's large pill. */
  variant?: 'hero' | 'end';
}) {
  function remember(event: FormEvent<HTMLFormElement>) {
    const handle = new FormData(event.currentTarget).get('handle');
    rememberWantedHandle(typeof handle === 'string' ? handle : '');
  }

  const end = variant === 'end';
  return (
    <form className={end ? styles.endClaim : styles.claim} action="/signup" method="get" onSubmit={remember}>
      <label htmlFor={id} className={styles.srOnly}>
        {label}
      </label>
      <span className={end ? styles.endField : styles.claimField}>
        {end ? (
          <Peek variant="claim" width={104} right={40} top={-55.5} />
        ) : (
          <Peek variant="claim" width={78} right={26} top={-41.6} />
        )}
        <span aria-hidden="true" className={styles.claimPrefix}>
          curios.my/
        </span>
        <input
          id={id}
          name="handle"
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={30}
        />
      </span>
      <button type="submit" className={`${styles.btn} ${end ? styles.endButton : ''}`}>
        {button}
      </button>
    </form>
  );
}
