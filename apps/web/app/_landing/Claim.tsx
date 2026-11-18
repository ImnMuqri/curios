'use client';

import { useState, type FormEvent } from 'react';
import { rememberWantedHandle } from '../../lib/wanted-handle.js';
import { LivePeek } from '../_peek/LivePeek.js';
import calm from './calm.module.css';
import styles from './claim.module.css';

/**
 * The `curios.my/` field (Landing2 board): type the address you want, then
 * sign up. The handle is kept in browser storage and pre-fills the claim
 * screen after sign-up and email verification (lib/wanted-handle.ts).
 *
 * A real GET form to /signup, so it still goes somewhere with no JavaScript;
 * it just arrives without the pre-fill. In the hero a live Peek sits behind
 * the field and ducks while you type; the closing's field has none (L2:871).
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
  variant?: 'hero' | 'end';
}) {
  const [typing, setTyping] = useState(false);
  function remember(event: FormEvent<HTMLFormElement>) {
    const handle = new FormData(event.currentTarget).get('handle');
    rememberWantedHandle(typeof handle === 'string' ? handle : '');
  }

  return (
    <form className={styles.claim} action="/signup" method="get" onSubmit={remember}>
      <label htmlFor={id} className={calm.srOnly}>
        {label}
      </label>
      <span className={styles.wrap} data-field="" data-typing={typing ? '' : undefined}>
        {variant === 'hero' ? (
          <span className={styles.pk}>
            <LivePeek width={78} follow />
          </span>
        ) : null}
        <span className={styles.cin}>
          <span aria-hidden="true">curios.my/</span>
          <input
            id={id}
            name="handle"
            placeholder={placeholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={30}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
          />
        </span>
      </span>
      <button type="submit" className={`${calm.btn} ${calm.dark} ${styles.go}`}>
        {button}
      </button>
    </form>
  );
}
