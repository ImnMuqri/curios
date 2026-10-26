'use client';

import { useState, type FormEvent } from 'react';
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReasonKey } from '@curios/core/report';
import { SystemCard, SystemShell, systemStyles } from '../../_system/SystemShell.js';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { reportCopy } from './copy.js';
import styles from './report.module.css';

const REASONS = Object.keys(REPORT_REASONS) as ReportReasonKey[];

export interface ReportInput {
  reason: ReportReasonKey;
  details?: string;
}

/**
 * "Report this page": the System board's shell, a list of reasons and an optional note.
 * Not drawn on any board (DEVIATIONS 219). The owner is never told who reported.
 */
export function ReportForm({
  displayName,
  language,
  onSubmit,
}: {
  displayName: string;
  language: string;
  onSubmit: (input: ReportInput) => Promise<unknown>;
}) {
  const copy = reportCopy(language);
  const lang = language === 'ms' ? 'ms' : 'en';
  const [reason, setReason] = useState<ReportReasonKey | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason || busy) return;
    setError('');
    setBusy(true);
    try {
      const note = details.trim();
      await onSubmit(note ? { reason, details: note } : { reason });
      setSent(true);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) setError(copy.tooMany);
      else setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <SystemShell>
        <SystemCard art={null} title={copy.heading(displayName)} lede={copy.done} ledeRole="status" />
      </SystemShell>
    );
  }

  return (
    <SystemShell>
      <SystemCard art={null} title={copy.heading(displayName)} lede={copy.lede}>
        <form onSubmit={(event) => void submit(event)} className={styles.form}>
          <fieldset className={styles.reasons}>
            <legend className={styles.legend}>{copy.heading(displayName)}</legend>
            {REASONS.map((key) => (
              <label key={key} className={styles.reason}>
                <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
                <span>{REPORT_REASONS[key][lang]}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.note}>
            <span>{copy.details}</span>
            <textarea value={details} maxLength={REPORT_DETAILS_MAX} rows={4} onChange={(event) => setDetails(event.target.value)} />
          </label>
          {error ? (
            <p className={systemStyles.alert} role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={systemStyles.go} disabled={!reason || busy}>
            {copy.send}
          </button>
        </form>
      </SystemCard>
    </SystemShell>
  );
}

/** Supplies the real submit handler; the API's own tests cover what the route does. */
export function Report({ handle, displayName, language }: { handle: string; displayName: string; language: string }) {
  return (
    <ReportForm
      displayName={displayName}
      language={language}
      onSubmit={(input) => apiFetch(`/pages/${encodeURIComponent(handle)}/report`, { method: 'POST', body: JSON.stringify(input) })}
    />
  );
}
