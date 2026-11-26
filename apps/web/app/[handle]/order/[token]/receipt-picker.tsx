'use client';

import { useId, useState, type ChangeEvent } from 'react';
import type { ShopCopy } from '../../shop/copy.js';
import { ACCEPTED, receiptTooBig, typeOf } from './receipt-file.js';
import styles from './order.module.css';

/**
 * The receipt box for paying first, at checkout: the same box as the order page's upload (same file
 * rules, same look), but it only holds the file. Nothing is sent until the customer presses Send order,
 * so choosing a file here changes the form and nothing else.
 */
export function ReceiptPicker(props: {
  copy: ShopCopy;
  /** The file held for sending, or null. */
  file: { name: string } | null;
  onPick: (file: File, contentType: string) => void;
  /** Said under the box, politely: why Send order waits, or why the receipt went. */
  hint: string | null;
  /** The id of that hint, for the button to point at. */
  hintId: string;
  disabled?: boolean;
}) {
  const { copy } = props;
  const problemId = useId();
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // The same file chosen again after a refusal must fire change again.
    input.value = '';
    if (!file || props.disabled) return;
    const contentType = await typeOf(file);
    if (!contentType || receiptTooBig(file)) {
      setProblem(copy.receiptInvalid);
      return;
    }
    setProblem(null);
    props.onPick(file, contentType);
  }

  const input = (
    <input
      type="file"
      className={styles.file}
      // No type in the list would refuse a file a picker sends untyped; the check above says why instead.
      accept={`${ACCEPTED.join(',')},.jpg,.jpeg,.png,.webp,.pdf`}
      aria-disabled={props.disabled || undefined}
      onClick={(event) => {
        if (props.disabled) event.preventDefault();
      }}
      onChange={(event) => void choose(event)}
      aria-describedby={problem ? problemId : undefined}
    />
  );

  return (
    <>
      {props.file ? (
        <>
          <div className={`${styles.upload} ${styles.sent}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span>
              <b>{props.file.name}</b>
              <span>{copy.receiptAttached}</span>
            </span>
          </div>
          <label className={styles.replace}>
            {input}
            <span>{copy.uploadDifferent}</span>
          </label>
        </>
      ) : (
        <label className={styles.upload}>
          {input}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          <span>
            <b>{copy.attachReceipt}</b>
            <span>{copy.uploadHint}</span>
          </span>
        </label>
      )}
      {problem ? (
        <p id={problemId} className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      {props.hint ? (
        <p id={props.hintId} className={styles.hint} role="status">
          {props.hint}
        </p>
      ) : null}
    </>
  );
}
