'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { formatMalaysianPhone } from '@curios/core/phone';
import { formatRinggit } from '@curios/core/store';
import type { OwnerLead } from '@curios/db-read';
import inbox from '../_ui/inbox.module.css';
import { InlineConfirm } from '../_ui/inline-confirm.js';
import { rovingIndex } from '../_ui/pill-tabs.js';
import { SheetAction, SheetHint, SideSheet } from '../_ui/side-sheet.js';
import { enquiryItemName } from './enquiry.js';
import { enquiryFirstMessage, firstMessage, waNumber } from './first-message.js';
import styles from './leads.module.css';

export type LeadStatus = OwnerLead['status'];

/** A lead as the screen gets it: an enquiry's item photo as a URL, made on the server from its key. */
export type LeadRow = OwnerLead & { itemPhotoUrl?: string | null };

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

/** A tag's colour family in the inbox kit (inbox.module.css `.tag[data-tone]`); none is the kit's grey. */
const TAGS: Record<LeadStatus, { label: string; tone?: 'new' | 'ok' }> = {
  NEW: { label: 'New', tone: 'new' },
  CONTACTED: { label: 'Contacted' },
  SOLD: { label: 'Sold', tone: 'ok' },
  CLOSED: { label: 'Closed' },
};

/** The board's tag for a status (Dash.html `.li .tag`): New blue, Sold green, Contacted and Closed grey. */
export function LeadTag({ status }: { status: LeadStatus }) {
  const tag = TAGS[status];
  return (
    <span className={inbox.tag} data-tone={tag.tone}>
      {tag.label}
    </span>
  );
}

const CHAT = 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z';

const KL = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;
// Built once, not per call: the list and the detail format several dates a render.
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: KL });
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: KL, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: KL, weekday: 'short', day: 'numeric', month: 'short' });
const dayOf = (date: Date) => DAY_FORMAT.format(date);

/** "9:14am", in Malaysia. */
export function clock(date: Date): string {
  const parts = CLOCK_FORMAT.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour % 12 || 12}:${minute}${hour < 12 ? 'am' : 'pm'}`;
}

/** "Tue 10 Nov", in Malaysia. */
function dateLabel(date: Date): string {
  const parts = DATE_FORMAT.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/**
 * The board's way of saying when a lead's conversation began: "Today 9:14am", "Yesterday 4:30pm",
 * then the day itself, "Tue 10 Nov" (Dash.html `.det .k`). `withTime` puts a comma before the
 * clock and keeps it on an older day ("Tue 10 Nov, 9:14am"), as the conversation sheet's line has it.
 */
export function leadWhen(date: Date, now: Date, withTime = false): string {
  const day = dayOf(date);
  const sep = withTime ? ', ' : ' ';
  if (day === dayOf(now)) return `Today${sep}${clock(date)}`;
  if (day === dayOf(new Date(now.getTime() - DAY_MS))) return `Yesterday${sep}${clock(date)}`;
  return withTime ? `${dateLabel(date)}, ${clock(date)}` : dateLabel(date);
}

/** The ring's four steps (owner, 19 Nov 2026, Q2): how much is known, from the number alone to everything. */
export const READY = ['Start with hello', 'Ask a little more', 'Almost there', 'Ready to quote'] as const;

/** A chat lead's three picked-out details, as the board's rows name them. */
const CHAT_FIELDS = [
  { key: 'product', label: 'Wants' },
  { key: 'date', label: 'When' },
  { key: 'location', label: 'Where' },
] as const;

/** An enquiry's three, picked out of their message. */
const ENQUIRY_FIELDS = [
  { key: 'date', label: 'When' },
  { key: 'people', label: 'For' },
  { key: 'budget', label: 'Budget' },
] as const;

const fieldsOf = (lead: Pick<OwnerLead, 'enquiry'>) => (lead.enquiry ? ENQUIRY_FIELDS : CHAT_FIELDS);

const known = (value: string | null | undefined): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * How many of a lead's four details are known (owner, 19 Nov 2026, Q2): the number itself is the
 * first, always, then the three picked out (a chat lead's Wants, When and Where; an enquiry's
 * When, For and Budget). So 1 to 4.
 */
export function detailsKnown(lead: Pick<OwnerLead, 'enquiry' | 'slots'>): number {
  return 1 + fieldsOf(lead).filter((field) => known(lead.slots?.[field.key])).length;
}

const RING = 2 * Math.PI * 18;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What a failed move says: the API's words, or a plain try again. */
export function failureText(failure: unknown, fallback = 'That did not save. Try again.'): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

/** One line of the conversation, as the board's sheet draws it: theirs dark on the right, the page's in a card on the left. */
function Line({ line, name }: { line: OwnerLead['transcript'][number]; name: string }) {
  return line.role === 'USER' ? (
    <span className={styles.q}>{line.content}</span>
  ) : (
    <span className={styles.a}>
      <small>{name}’s page</small>
      {line.content}
    </span>
  );
}

/**
 * One number, as the calm board's lead card (Dash.html `.det.xd`, data-ld): where it came from
 * and when, the number, where the owner is with it (a four-way segment), how much is known (the
 * ring), what was picked out (a chat lead's Wants, When, Where; an enquiry's item card, When, For,
 * Budget, their message and name), the conversation in a side sheet, and the one way to reach
 * them: on a new lead a first message to edit and Send on WhatsApp, which marks it contacted (the
 * moment the owner reached out); after that, Open WhatsApp. Deleting asks first, because a phone
 * number gone is gone.
 *
 * Renders the card's contents; the screen puts them in the kit's `.det`. The heading takes focus
 * (tabIndex -1) when a phone opens the lead as its own view. Every failure goes to `warn`, the
 * screen's toast in its error tone.
 */
export function LeadDetail({
  lead,
  status,
  displayName,
  language,
  now,
  actions,
  onStatus,
  onDeleted,
  say,
  warn,
  sent = false,
  onSent,
}: {
  lead: LeadRow;
  /** The status as the screen shows it now, which may be ahead of `lead.status`. */
  status: LeadStatus;
  displayName: string;
  language: string;
  now: Date;
  actions: LeadActions;
  /** Shows a new status at once; the screen puts it back if the save fails. */
  onStatus: (status: LeadStatus) => Promise<void>;
  onDeleted: () => void;
  /** The screen's toast ("Marked contacted."), which outlives this panel. */
  say: (text: string) => void;
  /** The toast's error tone (no tick, role alert, stays): what failed. */
  warn: (text: string) => void;
  /** Sent on WhatsApp from this card in this visit: the first message stays, its Send turned to the done line. */
  sent?: boolean;
  onSent?: () => void;
}) {
  const enquiry = lead.enquiry;
  const [message, setMessage] = useState(() =>
    enquiry
      ? enquiryFirstMessage(displayName, { name: enquiry.name, item: enquiryItemName(lead) }, lead.slots, language)
      : firstMessage(displayName, lead.slots, language),
  );
  const [copied, setCopied] = useState(false);
  const [talk, setTalk] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const phone = formatMalaysianPhone(lead.phone);
  const number = waNumber(lead.phone);
  const count = detailsKnown(lead);
  const ready = READY[count - 1] ?? READY[0];

  async function choose(next: LeadStatus, words: string) {
    if (next === status) return;
    try {
      await onStatus(next);
      say(words);
    } catch (failure) {
      warn(failureText(failure));
    }
  }

  // Reaching out is what Contacted means; a lead already past New stays where the owner put it.
  const reachedOut = () => {
    if (status === 'NEW') void choose('CONTACTED', 'WhatsApp opened. Marked contacted.');
    else say('WhatsApp opened.');
  };

  // A radio group (WAI-ARIA): one tab stop, the arrows, Home and End move and choose.
  const checkedAt = STATUSES.findIndex((s) => s.id === status);
  function onStatusKey(event: KeyboardEvent<HTMLButtonElement>, at: number) {
    const next = rovingIndex(event.key, at, STATUSES.length, true);
    if (next === null) return;
    event.preventDefault();
    radios.current[next]?.focus();
    const s = STATUSES[next]!;
    void choose(s.id, `Marked ${s.label.toLowerCase()}.`);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the message is on screen to select.
    }
  }

  const name = enquiryItemName(lead);
  const from = enquiry?.item?.fromCents ?? null;
  const note = enquiry?.note?.trim();
  const theirName = enquiry?.name?.trim();
  // The done line only once the move to Contacted has held (a failed save puts New, and Send, back).
  const done = sent && status !== 'NEW';
  const left = enquiry ? `sent from your shop at ${clock(lead.createdAt)}` : `left their number at ${clock(lead.createdAt)}`;

  return (
    <>
      <p className={inbox.k}>
        {enquiry ? 'Enquiry from the shop' : 'From the chat'} · {leadWhen(lead.startedAt, now)}
      </p>
      <h2 className={styles.number} tabIndex={-1} data-detail-heading="">
        {phone}
      </h2>

      <div className={styles.status} role="radiogroup" aria-label="Lead status">
        {STATUSES.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            className={styles.statusOption}
            aria-checked={status === s.id}
            tabIndex={i === (checkedAt < 0 ? 0 : checkedAt) ? 0 : -1}
            onClick={() => void choose(s.id, `Marked ${s.label.toLowerCase()}.`)}
            onKeyDown={(event) => onStatusKey(event, i)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className={styles.ring}>
        <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
          <circle cx="22" cy="22" r="18" />
          <circle cx="22" cy="22" r="18" className={styles.ringFill} strokeDasharray={`${((RING * count) / 4).toFixed(1)} ${RING.toFixed(1)}`} />
        </svg>
        <span>
          <b>{ready}</b>
          <small>{count} of 4 details known</small>
        </span>
      </div>

      {enquiry ? (
        <>
          <p className={styles.lab}>
            Their enquiry<span>Picked out of their message</span>
          </p>
          {name ? (
            <div className={styles.item}>
              <span className={styles.itemThumb} aria-hidden="true">
                {lead.itemPhotoUrl ? <img src={lead.itemPhotoUrl} alt="" /> : null}
              </span>
              <span className={styles.itemText}>
                <b>{name}</b>
                <small>{enquiry.item ? (from !== null ? `Ask for a price · from ${formatRinggit(from)}` : 'Ask for a price') : 'No longer in your shop'}</small>
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.lab}>Picked out of the conversation</p>
      )}

      <dl className={`${inbox.kv2} ${styles.kv}`} aria-label={enquiry ? 'Their enquiry' : 'Picked out of the conversation'}>
        {fieldsOf(lead).map((field) => {
          const value = lead.slots?.[field.key];
          return (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>{known(value) ? value : <i className={styles.missing}>Not mentioned</i>}</dd>
            </div>
          );
        })}
      </dl>

      {enquiry && note ? (
        <div className={styles.note}>
          <small>Their message</small>
          {note}
        </div>
      ) : null}
      {enquiry && theirName ? <p className={styles.hint}>Name: {theirName}</p> : null}

      <button ref={opener} type="button" className={styles.conv} onClick={() => setTalk(true)}>
        <span className={styles.convIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d={CHAT} />
          </svg>
        </span>
        <span className={styles.convText}>
          <b>See the conversation</b>
          <small>
            {plural(lead.messageCount, 'message')} · {left}
          </small>
        </span>
        <em aria-hidden="true">›</em>
      </button>

      {status === 'NEW' || sent ? (
        <div className={styles.first}>
          <p className={styles.lab}>
            First message<span>Edit it before you send</span>
          </p>
          <textarea className={styles.message} value={message} aria-label="First message" rows={4} onChange={(event) => setMessage(event.target.value)} />
          <div className={styles.sendRow}>
            {/* After Send the same link stays (focus with it, and it opens WhatsApp again), as the board's done line. */}
            <a
              className={styles.send}
              data-done={done || undefined}
              href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                onSent?.();
                reachedOut();
              }}
            >
              {done ? null : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={CHAT} />
                </svg>
              )}
              {done ? 'WhatsApp opened. Marked contacted.' : 'Send on WhatsApp'}
            </a>
            <button type="button" className={styles.copy} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <a className={styles.whatsapp} href={`https://wa.me/${number}`} target="_blank" rel="noopener noreferrer" onClick={reachedOut}>
          Open WhatsApp
        </a>
      )}

      <p className={styles.hint}>They agreed to be contacted when they left it. Delete it once you are done.</p>

      <InlineConfirm
        trigger="Delete lead"
        question="Delete this number and the conversation with it? It cannot be brought back."
        yes="Yes, delete"
        no="Keep it"
        onYes={async () => {
          await actions.remove(lead.id);
          onDeleted();
        }}
        onError={(failure) => warn(failureText(failure, 'Something failed. Try again.'))}
      />

      <SideSheet
        open={talk}
        onClose={() => setTalk(false)}
        title="The conversation"
        subtitle={`${phone} · ${leadWhen(lead.startedAt, now, true)} on your page`}
        closeLabel="Close the conversation"
        returnFocusTo={opener}
        footer={
          <>
            <SheetHint>Only you see this.</SheetHint>
            <SheetAction onClick={() => setTalk(false)}>Close</SheetAction>
          </>
        }
      >
        {talk ? (
          <div className={styles.chat}>
            {lead.transcript.slice(0, lead.capturedAfter).map((line, i) => (
              <Line key={i} line={line} name={displayName} />
            ))}
            {/* An enquiry's number came with it, not part-way through a chat. */}
            {enquiry ? null : <span className={styles.left}>Left their number · {clock(lead.createdAt)}</span>}
            {lead.transcript.slice(lead.capturedAfter).map((line, i) => (
              <Line key={lead.capturedAfter + i} line={line} name={displayName} />
            ))}
            {lead.messageCount > lead.transcript.length ? (
              <p className={styles.more}>
                The first {lead.transcript.length} of {lead.messageCount} messages.
              </p>
            ) : null}
          </div>
        ) : null}
      </SideSheet>
    </>
  );
}
