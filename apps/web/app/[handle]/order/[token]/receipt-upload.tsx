'use client';

import { useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { RECEIPT_MAX_BYTES } from '@curios/core/orders';
import { ApiError, apiFetch } from '../../../../lib/api.js';
import type { ShopCopy } from '../../shop/copy.js';
import styles from './order.module.css';

/** What the API takes; it checks the first bytes too, so this is only the early word. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** The file as base64, without the data URL's prefix. */
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // readAsDataURL always yields a string.
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * The board's "Upload your receipt" box. A label around a file input, so the
 * whole box opens the picker and the input keeps its own keyboard handling.
 * On success the page's data is read again, and the box gives way to the
 * "sent" line the server now draws.
 */
export function ReceiptUpload(props: { token: string; displayName: string; copy: ShopCopy }) {
  const { copy } = props;
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const busy = sending || refreshing;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // The same file chosen again after a refusal must fire change again.
    input.value = '';
    if (!file) return;
    if (!ACCEPTED.includes(file.type) || file.size > RECEIPT_MAX_BYTES) {
      setProblem(copy.receiptInvalid);
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      const data = await base64(file);
      await apiFetch(`/store/orders/${encodeURIComponent(props.token)}/receipt`, {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type, data }),
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === 'ORDER_ALREADY_PAID' || code === 'ORDER_CANCELLED') {
        // The order moved on under the customer: the page, read again, says how.
        startRefresh(() => router.refresh());
      } else if (code === 'INVALID_RECEIPT') {
        setProblem(copy.receiptInvalid);
      } else if (code === 'STORAGE_NOT_CONFIGURED') {
        setProblem(copy.receiptsOff(props.displayName));
      } else {
        setProblem(copy.failed);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <label className={styles.upload} data-busy={busy || undefined}>
        <input
          type="file"
          className={styles.file}
          accept={ACCEPTED.join(',')}
          disabled={busy}
          onChange={(event) => void choose(event)}
          aria-describedby={problem ? 'receipt-problem' : undefined}
        />
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
        <span>
          <b>{copy.uploadReceipt}</b>
          <span>{busy ? copy.uploading : copy.uploadHint}</span>
        </span>
      </label>
      {problem ? (
        <p id="receipt-problem" className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}
