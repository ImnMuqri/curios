'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { formatMalaysianPhone } from '@curios/core/phone';
import type { OwnerLead } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import inbox from '../_ui/inbox.module.css';
import { PageReply } from '../_ui/page-reply.js';
import { VisitorQuestion } from '../_ui/visitor-question.js';
import { relativeTime } from '../_ui/relative-time.js';
import { firstMessage, waNumber } from './first-message.js';
import styles from './leads.module.css';

export type LeadStatus = OwnerLead['status'];

// Function-typed properties, not method shorthand: they are handed around as
// bare values, and method syntax's implicit `this` trips unbound-method.
export interface LeadActions {
  setStatus: (leadId: string, status: LeadStatus) => Promise<void>;
  remove: (leadId: string) => Promise<void>;
}

export const STATUSES: { id: LeadStatus; label: string }[] = [
  { id: 'NEW', label: 'New' },
  { id: 'CONTACTED', label: 'Contacted' },
  // Apart from Closed: a lead is often only an enquiry, and ends without a sale.
  { id: 'SOLD', label: 'Sold' },
  { id: 'CLOSED', label: 'Closed' },
];

const CHAT = 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z';

const SLOTS = [
  { key: 'product', label: 'Wants' },
  { key: 'date', label: 'When' },
  { key: 'location', label: 'Where' },
] as const;

/** One line of the chat: the visitor's in a bubble, the page's as plain text. */
function Line({ line, name }: { line: OwnerLead['transcript'][number]; name: string }) {
  return line.role === 'USER' ? <VisitorQuestion>{line.content}</VisitorQuestion> : <PageReply name={name}>{line.content}</PageReply>;
}

const READY = ['Start with hello', 'Ask a little more', 'Almost there', 'Ready to quote'];
const RING = 2 * Math.PI * 18;

/**
 * One number, on its own: who left it and where, where the owner is with
 * it, what they are after, the conversation it came from, and a first
 * message to send. Opening WhatsApp on a new lead marks it contacted, as the
 * board does: that is the moment the owner reached out.
 *
 * Deleting asks first, because a phone number gone is gone.
 */
export function LeadDetail({
  lead,
  status,
  handle,
  displayName,
  language,
  look,
  now,
  actions,
  onStatus,
  onDeleted,
  say,
}: {
  lead: OwnerLead;
  /** The status as the screen shows it now, which may be ahead of `lead.status`. */
  status: LeadStatus;
  handle: string;
  displayName: string;
  language: string;
  look: Parameters<typeof themeAttrs>[0];
  now: Date;
  actions: LeadActions;
  /** Shows a new status at once; the screen puts it back if the save fails. */
  onStatus: (status: LeadStatus) => Promise<void>;
  onDeleted: () => void;
  /** The screen's toast ("Marked contacted."), which outlives this panel. */
  say: (text: string) => void;
}) {
  const [message, setMessage] = useState(() => firstMessage(displayName, lead.slots, language));
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const phone = formatMalaysianPhone(lead.phone);
  const number = waNumber(lead.phone);
  const score = Math.max(0, Math.min(3, lead.score));
  const at = STATUSES.findIndex((s) => s.id === status);

  async function choose(next: LeadStatus, words: string) {
    if (next === status) return;
    setError('');
    try {
      await onStatus(next);
      say(words);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');
    }
  }

  // Reaching out is what Contacted means; a lead already past New stays where the owner put it.
  const reachedOut = () => {
    if (status === 'NEW') void choose('CONTACTED', 'WhatsApp opened. Marked contacted.');
    else say('WhatsApp opened.');
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the message is on screen to select.
    }
  }

  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await actions.remove(lead.id);
      onDeleted();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Something failed. Try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={inbox.detailInner}>
      <div className={styles.head}>
        <span>
          <h2>{phone}</h2>
          <p>
            Left their number {relativeTime(lead.createdAt, now)} · in the chat on curios.my/{handle}
          </p>
        </span>
        <a className={styles.whatsapp} href={`https://wa.me/${number}`} target="_blank" rel="noopener noreferrer" onClick={reachedOut}>
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path d={CHAT} />
          </svg>
          Open WhatsApp
        </a>
      </div>

      <div className={styles.status} role="radiogroup" aria-label="Lead status" data-status={status} style={{ '--at': at } as CSSProperties}>
        {STATUSES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={status === s.id} onClick={() => void choose(s.id, `Marked ${s.label.toLowerCase()}.`)}>
            {s.label}
          </button>
        ))}
      </div>

      <section className={inbox.section} aria-labelledby="after-title">
        <h3 id="after-title">
          What they&apos;re after<span>Picked out of the conversation</span>
        </h3>
        <div className={styles.slots}>
          {SLOTS.map((slot, i) => {
            const value = lead.slots?.[slot.key] ?? null;
            return (
              <div key={slot.key} className={styles.slot} data-missing={value ? undefined : ''} style={{ animationDelay: `${i * 60}ms` }}>
                <small>{slot.label}</small>
                <b>{value ?? 'Not mentioned'}</b>
              </div>
            );
          })}
          <div className={styles.meter}>
            <svg viewBox="0 0 44 44" width="48" height="48" aria-hidden="true">
              <circle cx="22" cy="22" r="18" />
              <circle cx="22" cy="22" r="18" strokeDasharray={RING} strokeDashoffset={RING * (1 - score / 3)} transform="rotate(-90 22 22)" />
            </svg>
            <b>{score} of 3</b>
            <span>{READY[score]}</span>
          </div>
        </div>
      </section>

      <section className={inbox.section}>
        <div className={styles.pair}>
          <div>
            <h3 className={styles.pairTitle}>
              The conversation<span>{lead.messageCount} messages</span>
            </h3>
            <div className={`${bento.theme} ${styles.convo}`} {...themeAttrs(look)} aria-label="The conversation">
              {lead.transcript.slice(0, lead.capturedAfter).map((line, i) => (
                <Line key={i} line={line} name={displayName} />
              ))}
              <span className={styles.leftNumber}>
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                Left their number
              </span>
              {lead.transcript.slice(lead.capturedAfter).map((line, i) => (
                <Line key={lead.capturedAfter + i} line={line} name={displayName} />
              ))}
            </div>
            {lead.messageCount > lead.transcript.length ? (
              <p className={styles.more}>
                The first {lead.transcript.length} of {lead.messageCount} messages.
              </p>
            ) : null}
          </div>
          <div>
            <h3 className={styles.pairTitle}>
              Your first message<span>Edit it before you send</span>
            </h3>
            <div className={styles.reply}>
              <div className={styles.replyHead}>
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                  <path d={CHAT} />
                </svg>
                To {phone}
                <span>{[...message].length} characters</span>
              </div>
              <textarea value={message} aria-label="WhatsApp message" onChange={(event) => setMessage(event.target.value)} />
              <div className={styles.replyFoot}>
                <a
                  className={styles.whatsapp}
                  data-small=""
                  href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={reachedOut}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                  Send on WhatsApp
                </a>
                <button type="button" className={styles.outline} onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.foot}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        </svg>
        <span>They agreed to be contacted when they left it. Delete it once you are done.</span>
        <span className={styles.footEnd}>
          {confirming ? (
            <span className={styles.confirm} role="group" aria-label="Confirm deleting this lead">
              Delete this number and the conversation with it? It cannot be brought back.
              <button type="button" disabled={busy} onClick={() => void remove()}>
                Yes, delete
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={styles.ghost} onClick={() => setConfirming(true)}>
              Delete lead
            </button>
          )}
        </span>
      </div>

      {error ? (
        <div className={styles.error}>
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}
    </div>
  );
}
