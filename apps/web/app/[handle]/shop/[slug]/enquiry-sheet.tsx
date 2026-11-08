'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ENQUIRY_MESSAGE_MAX, ENQUIRY_NAME_MAX, formatRinggit } from '@curios/core/store';
import type { ShopCopy } from '../copy.js';
import type { EnquiryHandoff } from '../enquiry.js';
import styles from './enquiry-sheet.module.css';

type Field = 'message' | 'name' | 'phone';

/**
 * An Ask item's enquiry sheet: the Public board's `.enq` (8 Nov). The item at
 * the top, one message box, a name and a WhatsApp number, and Send enquiry.
 * A bottom sheet over the product page; it sends `POST /enquiries/:handle`
 * and hands the result to `onSent`, which takes the customer to the chat.
 * In the Store preview (`preview`) it shows the same sheet and sends nothing.
 */
export function EnquirySheet(props: {
  handle: string;
  displayName: string;
  item: { id: string; name: string; photoUrl: string | null; priceCents: number | null };
  copy: ShopCopy;
  preview?: boolean;
  onClose: () => void;
  onSent: (handoff: EnquiryHandoff) => void;
}) {
  const { copy, item } = props;
  const titleId = useId();
  const errorId = useId();
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [invalid, setInvalid] = useState<Field | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const fields = { message: useRef<HTMLTextAreaElement>(null), name: useRef<HTMLInputElement>(null), phone: useRef<HTMLInputElement>(null) };
  const { onClose } = props;

  // Focus moves in on open and goes back to what opened the sheet on close; the page behind does not scroll.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fields.message.current?.focus();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = overflow;
      opener?.focus();
    };
    // Once per open: the sheet mounts when it opens and unmounts when it closes.
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !sheet.current) return;
    // Focus stays in the sheet: Tab past the last control comes back to the first.
    const focusable = [...sheet.current.querySelectorAll<HTMLElement>('textarea, input, button:not(:disabled)')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function fail(field: Field | null, text: string) {
    setInvalid(field);
    setError(text);
    if (field) fields[field].current?.focus();
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sending || props.preview) return;
    const text = message.trim();
    if (text === '') return fail('message', copy.enquiryNeedMessage);
    if (name.trim() === '') return fail('name', copy.enquiryNeedName);
    if (phone.trim() === '') return fail('phone', copy.enquiryNeedPhone);
    setInvalid(null);
    setError('');
    setSending(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/enquiries/${props.handle}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, message: text, name: name.trim(), phone: phone.trim(), consent: true }),
      });
      if (response.status === 201) {
        const body = (await response.json()) as { conversationId: string };
        props.onSent({ conversationId: body.conversationId, item: { name: item.name, photoUrl: item.photoUrl }, text });
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = body?.error?.code ?? '';
      // A 400 is the API's own words, verbatim, as the chat's capture card shows them: which number format works, or what to add.
      if (response.status === 400) fail(code === 'INVALID_PHONE' ? 'phone' : null, body?.error?.message ?? copy.enquiryFailed);
      else fail(null, copy.enquiryError(code) ?? body?.error?.message ?? copy.enquiryFailed);
    } catch {
      fail(null, copy.enquiryFailed);
    } finally {
      setSending(false);
    }
  }

  const price = item.priceCents === null ? null : formatRinggit(item.priceCents);
  const described = (field: Field) => (invalid === field ? { 'aria-invalid': true, 'aria-describedby': errorId } : {});

  return (
    <div className={styles.enq}>
      <button type="button" className={styles.dim} aria-label={copy.closeEnquiry} tabIndex={-1} onClick={onClose} />
      <div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <span className={styles.grab} aria-hidden="true" />
        <div className={styles.it}>
          <i aria-hidden="true">{item.photoUrl ? <img src={item.photoUrl} alt="" /> : item.name.trim().charAt(0).toUpperCase()}</i>
          <span>
            <b id={titleId}>{item.name}</b>
            <small>{copy.enquirySub(price)}</small>
          </span>
        </div>
        <form className={styles.form} onSubmit={(event) => void send(event)} noValidate>
          <label className={styles.q} htmlFor={`${titleId}-message`}>
            {copy.enquiryWhat}
          </label>
          <textarea
            id={`${titleId}-message`}
            ref={fields.message}
            className={styles.ta}
            placeholder={copy.enquiryPlaceholder}
            aria-label={copy.enquiryMessageLabel(props.displayName)}
            maxLength={ENQUIRY_MESSAGE_MAX}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            {...described('message')}
          />
          <div className={styles.who}>
            <input
              ref={fields.name}
              className={styles.field}
              aria-label={copy.yourName}
              placeholder={copy.yourName}
              autoComplete="name"
              maxLength={ENQUIRY_NAME_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
              {...described('name')}
            />
            <input
              ref={fields.phone}
              className={styles.field}
              aria-label={copy.yourWhatsApp}
              placeholder={copy.whatsappNumber}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={24}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              {...described('phone')}
            />
          </div>
          {error ? (
            <p id={errorId} className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {props.preview ? <p className={styles.note}>{copy.enquiryPreview}</p> : null}
          <button type="submit" className={styles.go} disabled={sending || props.preview} aria-busy={sending || undefined}>
            {sending ? copy.sendingEnquiry : copy.sendEnquiry}
          </button>
        </form>
        <p className={styles.foot}>{copy.enquiryFoot(props.displayName)}</p>
      </div>
    </div>
  );
}
