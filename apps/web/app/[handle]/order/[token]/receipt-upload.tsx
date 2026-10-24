'use client';

import { useId, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { RECEIPT_MAX_BYTES } from '@curios/core/orders';
import { ApiError, apiFetch } from '../../../../lib/api.js';
import type { ShopCopy } from '../../shop/copy.js';
import styles from './order.module.css';

/** What the API takes; it checks the first bytes too, so this is only the early word. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** The first bytes of the four kinds, as the API's decodeReceipt checks them. */
function sniff(bytes: Uint8Array): string | null {
  const at = (offset: number, text: string) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, '%PDF')) return 'application/pdf';
  return null;
}

function head(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

/**
 * The file's type as it is sent. Some Android pickers give no type at all;
 * then the extension says, and failing that its first bytes. The API checks
 * the bytes against this label either way, so the server has the last word.
 */
async function typeOf(file: File): Promise<string | null> {
  if (file.type) return ACCEPTED.includes(file.type) ? file.type : null;
  const ext = file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : '';
  return BY_EXTENSION[ext] ?? sniff(await head(file).catch(() => new Uint8Array()));
}

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
 * "sent" line the server now draws. With `replace`, it is the quiet "Upload a
 * different receipt" under that line: until the order is paid, a second
 * receipt replaces the first.
 */
export function ReceiptUpload(props: { token: string; displayName: string; copy: ShopCopy; replace?: boolean; preview?: boolean }) {
  // The Store editor's picture: the box as drawn, with no picker (and no router) behind it.
  if (props.preview) {
    const { copy } = props;
    return props.replace ? (
      <span className={styles.replace}>{copy.uploadDifferent}</span>
    ) : (
      <div className={styles.upload}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
        <span>
          <b>{copy.uploadReceipt}</b>
          <span>{copy.uploadHint}</span>
        </span>
      </div>
    );
  }
  return <LiveReceiptUpload {...props} />;
}

function LiveReceiptUpload(props: { token: string; displayName: string; copy: ShopCopy; replace?: boolean }) {
  const { copy } = props;
  const router = useRouter();
  const problemId = useId();
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const busy = sending || refreshing;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // The same file chosen again after a refusal must fire change again.
    input.value = '';
    // aria-disabled rather than disabled, so focus stays on the box while it sends.
    if (!file || busy) return;
    const contentType = await typeOf(file);
    if (!contentType || file.size > RECEIPT_MAX_BYTES) {
      setProblem(copy.receiptInvalid);
      return;
    }
    setProblem(null);
    setSending(true);
    try {
      const data = await base64(file);
      await apiFetch(`/store/orders/${encodeURIComponent(props.token)}/receipt`, {
        method: 'POST',
        body: JSON.stringify({ contentType, data }),
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

  const input = (
    <input
      type="file"
      className={styles.file}
      // No type in the list would refuse a file a picker sends untyped; the check above says why instead.
      accept={`${ACCEPTED.join(',')},.jpg,.jpeg,.png,.webp,.pdf`}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (busy) event.preventDefault();
      }}
      onChange={(event) => void choose(event)}
      aria-describedby={problem ? problemId : undefined}
    />
  );

  return (
    <>
      {props.replace ? (
        <label className={styles.replace} data-busy={busy || undefined}>
          {input}
          <span aria-live="polite">{busy ? copy.uploading : copy.uploadDifferent}</span>
        </label>
      ) : (
        <label className={styles.upload} data-busy={busy || undefined}>
          {input}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          <span>
            <b>{copy.uploadReceipt}</b>
            <span aria-live="polite">{busy ? copy.uploading : copy.uploadHint}</span>
          </span>
        </label>
      )}
      {problem ? (
        <p id={problemId} className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}
