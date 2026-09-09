'use client';

import { useState } from 'react';
import { Button } from '../button/Button.js';
import { Callout } from '../callout/Callout.js';
import { Field } from '../field/Field.js';
import styles from './CaptureCard.module.css';

/**
 * One field, and the first thing in this product that earns `kuning`.
 *
 * DESIGN.md reserves that accent for "a human needs to act", and this is the
 * moment: a customer who has said what they want, and a shop owner who cannot
 * reply until somebody leaves a number.
 *
 * BACKEND.md: "Capture takes one field, the phone. Slots come from the
 * transcript, not a form." A second field here would make this a form, and a
 * form at the end of a chat is a bounce.
 */
export function CaptureCard({
  shopName,
  onSubmit,
}: {
  shopName: string;
  onSubmit: (phone: string) => Promise<void>;
}) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className={styles.card}>
        <Callout tone="info">Got it. {shopName} will message you on WhatsApp.</Callout>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || phone.trim() === '') return;

    setError('');
    setBusy(true);
    try {
      await onSubmit(phone.trim());
      setDone(true);
    } catch (failure) {
      // Verbatim. The API's message says what to do next -- which number
      // format works, or that the shop already has it -- and rewriting it
      // here would swap instruction for apology.
      setError(failure instanceof Error ? failure.message : 'That failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={(event) => void submit(event)}>
      <p className={styles.lead}>Want {shopName} to message you back?</p>

      {/*
        Above the field, never in a tooltip, and it names the recipient: the
        shop, not us. BACKEND.md's PDPA minimum, and the one line here that is
        an obligation rather than a design choice.
      */}
      <p className={styles.consent}>
        Your number goes to {shopName} so they can reply on WhatsApp. Nobody else sees it.
      </p>

      <Field
        id="capture-phone"
        label="Your WhatsApp number"
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={setPhone}
      />

      {error ? <Callout tone="error">{error}</Callout> : null}

      <Button type="submit" busy={busy}>
        {busy ? 'Sending…' : 'Send my number'}
      </Button>
    </form>
  );
}
