'use client';

import { useEffect, useId, useRef, useState } from 'react';
import styles from './reason-dialog.module.css';

/** The one dialog every audited admin change goes through: a reason, optionally a typed confirmation. */
export function ReasonDialog({
  title,
  text,
  confirmLabel,
  placeholder,
  danger = false,
  ownerSees = false,
  typeToConfirm,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  placeholder: string;
  danger?: boolean;
  /** Shows "The owner sees this." under the box, for actions that email the reason. */
  ownerSees?: boolean;
  /** When set, confirm also waits for this exact text to be typed. */
  typeToConfirm?: string;
  /** Gets the trimmed reason. A throw shows its message in the dialog; the dialog stays open. */
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const ids = useId();
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  const blocked = busy || !reason.trim() || (typeToConfirm !== undefined && typed.trim() !== typeToConfirm);

  async function confirm() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.scrim} onClick={busy ? undefined : onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        <h3>{title}</h3>
        <p>{text}</p>

        <label htmlFor={`${ids}-why`}>Reason, for the audit log</label>
        <input
          ref={reasonRef}
          id={`${ids}-why`}
          value={reason}
          maxLength={500}
          placeholder={placeholder}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void confirm();
          }}
        />
        {ownerSees && <small className={styles.hint}>The owner sees this.</small>}

        {typeToConfirm !== undefined && (
          <>
            <label htmlFor={`${ids}-type`}>Type {typeToConfirm} to confirm</label>
            <input
              id={`${ids}-type`}
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </>
        )}

        {error && (
          <p className={styles.err} role="alert">
            {error}
          </p>
        )}

        <div className={styles.mact}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? styles.danger : styles.prim}
            disabled={blocked}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
