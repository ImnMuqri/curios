'use client';

import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Callout } from '@curios/ui';
import { ACCESS_NOTE_MAX, MAX_DIGITAL_FILES, MAX_DIGITAL_FILE_BYTES, digitalFileType, fileKind, parseCodes } from '@curios/core/digital';
import ui from '../_ui/editor.module.css';
import { checkDigital, type DigitalDraft } from './digital-draft.js';
import { timeLabel, toInstant, toMalaysia } from './session-time.js';
import type { Delivery, EditorItem, ItemsApi, StoredSession } from './store-types.js';
import styles from './store.module.css';

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

const DELIVERIES: { id: Delivery; name: string; note: string }[] = [
  { id: 'FILES', name: 'Files', note: 'PDF, template, video' },
  { id: 'LINK', name: 'A link', note: 'Course, private page' },
  { id: 'CODES', name: 'Codes', note: 'Vouchers, licence keys' },
  { id: 'SESSION', name: 'A session', note: 'A class or a call' },
];

const LIMIT_MB = MAX_DIGITAL_FILE_BYTES / 1_048_576;

/** 4_404_019 as "4.2 MB", 220_000 as "215 KB": a file's size the way the board writes it. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1_048_576;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/** "What it is": Physical or Digital, above Price. */
export function KindSwitch({ draft, onDraft }: { draft: DigitalDraft; onDraft: (change: Partial<DigitalDraft>) => void }) {
  const digital = draft.kind === 'DIGITAL';
  return (
    <>
      <div className={styles.sub}>
        <b id="kind-title">What it is</b>
        <span>{digital ? 'No day, pickup or delivery at checkout' : 'Customers pick a day, and pickup or delivery'}</span>
      </div>
      <div className={styles.pricedBy} role="radiogroup" aria-labelledby="kind-title" style={{ '--at': digital ? 1 : 0 } as CSSProperties}>
        {(
          [
            ['PHYSICAL', 'Physical'],
            ['DIGITAL', 'Digital'],
          ] as const
        ).map(([kind, label]) => (
          <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} onClick={() => draft.kind !== kind && onDraft({ kind })}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

type PanelProps = {
  /** The item as saved, or null before it has been. */
  item: EditorItem | null;
  api: ItemsApi;
  /** Sends what is waiting to be saved, then answers the saved item if it now is digital with this delivery. */
  ready: (delivery: Delivery) => Promise<EditorItem | null>;
  patchItem: (change: (item: EditorItem) => EditorItem) => void;
};

type DraftProps = { draft: DigitalDraft; onDraft: (change: Partial<DigitalDraft>) => void };

const NOT_YET = 'That has not saved yet. Give it a moment, then try again.';
const NEEDS_ITEM = 'Give it a name and a price first';

/** "How they get it": the four ways, and the panel for the one picked. Shown only for a digital item. */
export function DigitalPanels({ draft, onDraft, ...panel }: PanelProps & DraftProps) {
  return (
    <>
      <div className={styles.sub}>
        <b id="get-title">How they get it</b>
        <span>Sent after they pay, on their order page and by email</span>
      </div>
      <div className={styles.digitalTiles} role="group" aria-labelledby="get-title">
        {DELIVERIES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`${ui.tile} ${styles.deliveryTile} ${styles.digitalTile}`}
            aria-pressed={draft.delivery === option.id}
            onClick={() => draft.delivery !== option.id && onDraft({ delivery: option.id })}
          >
            <span className={ui.tick} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="12" height="12">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span>
              <b>{option.name}</b>
              <span>{option.note}</span>
            </span>
          </button>
        ))}
      </div>
      {draft.delivery === 'FILES' ? <FilesPanel {...panel} /> : null}
      {draft.delivery === 'LINK' ? <LinkPanel draft={draft} onDraft={onDraft} /> : null}
      {draft.delivery === 'CODES' ? <CodesPanel {...panel} /> : null}
      {draft.delivery === 'SESSION' ? <SessionPanel {...panel} draft={draft} onDraft={onDraft} /> : null}
    </>
  );
}

function FilesPanel({ item, api, ready, patchItem }: PanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState<{ name: string; done: number } | null>(null);
  const files = item?.delivery === 'FILES' ? item.files : [];
  const full = files.length >= MAX_DIGITAL_FILES;

  async function send(picked: File[]) {
    setError('');
    let held = files.length;
    for (const file of picked) {
      // The limits are checked here, before a byte leaves: the API would refuse them too, but only after the upload.
      if (held >= MAX_DIGITAL_FILES) return setError(`${MAX_DIGITAL_FILES} files is the most an item holds. Remove one to add another.`);
      if (file.size > MAX_DIGITAL_FILE_BYTES) return setError(`${file.name} is ${sizeLabel(file.size)}. The most for one file is ${LIMIT_MB} MB.`);
      if (!digitalFileType(file.name, file.type)) return setError(`${file.name} is not a PDF, image, ZIP, audio or video file.`);
      const current = await ready('FILES');
      if (!current) return setError(NOT_YET);
      setSending({ name: file.name, done: 0 });
      try {
        const stored = await api.uploadFile(current.id, file, (done) => setSending({ name: file.name, done }));
        held += 1;
        patchItem((cur) => ({ ...cur, files: [...cur.files, stored] }));
      } catch (failure) {
        setSending(null);
        return setError(message(failure));
      }
    }
    setSending(null);
  }

  async function remove(id: string) {
    setError('');
    try {
      await api.removeFile(item?.id ?? '', id);
      patchItem((cur) => ({ ...cur, files: cur.files.filter((f) => f.id !== id) }));
    } catch (failure) {
      setError(message(failure));
    }
  }

  const disabled = !item || full || sending !== null;
  const drop = (event: DragEvent) => {
    event.preventDefault();
    if (!disabled) void send([...event.dataTransfer.files]);
  };

  return (
    <div className={styles.dg}>
      {files.map((file) => (
        <div key={file.id} className={styles.dgFile}>
          <span className={styles.dgExt}>{fileKind({ name: file.name, contentType: '' }).slice(0, 4)}</span>
          <span className={styles.dgName}>
            <b>{file.name}</b>
            <small>{sizeLabel(file.sizeBytes)}</small>
          </span>
          <button type="button" className={ui.iconButton} aria-label={`Remove ${file.name}`} onClick={() => void remove(file.id)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ))}
      {sending ? (
        <div className={styles.dgFile} aria-live="polite">
          <span className={styles.dgExt}>{fileKind({ name: sending.name, contentType: '' }).slice(0, 4)}</span>
          <span className={styles.dgName}>
            <b>{sending.name}</b>
            <span className={styles.dgBar} role="progressbar" aria-label={`Uploading ${sending.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sending.done * 100)}>
              <i style={{ width: `${Math.round(sending.done * 100)}%` }} />
            </span>
          </span>
          <small className={styles.dgPercent}>{Math.round(sending.done * 100)}%</small>
        </div>
      ) : null}
      <button
        type="button"
        className={`${styles.drop} ${styles.dgDrop}`}
        disabled={disabled}
        title={!item ? NEEDS_ITEM : full ? `${MAX_DIGITAL_FILES} files is the most an item holds` : undefined}
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
        <b>{files.length > 0 ? 'Add another file' : 'Upload the files they get'}</b>
        <small>
          PDF, images, ZIP, audio or video. Up to {LIMIT_MB} MB each, {MAX_DIGITAL_FILES} files.
        </small>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Files they get"
        accept="application/pdf,image/*,application/zip,audio/*,video/*"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = '';
          if (picked.length > 0) void send(picked);
        }}
      />
      {error ? <Callout tone="error">{error}</Callout> : null}
      <p className={styles.dgNote}>Each buyer gets their own download links. They work 5 times each, for 30 days, and you can resend them from Orders.</p>
    </div>
  );
}

function LinkPanel({ draft, onDraft }: DraftProps) {
  const check = checkDigital(draft);
  return (
    <div className={styles.dg}>
      <label className={`${ui.float} ${styles.mono}`}>
        <em>Link they get</em>
        <input value={draft.link} inputMode="url" placeholder="https://" autoComplete="off" onChange={(event) => onDraft({ link: event.target.value })} />
      </label>
      {draft.link.trim() !== '' && 'error' in check ? (
        <p className={styles.dgHint} role="alert">
          {check.error}
        </p>
      ) : null}
      <div className={ui.float} style={{ marginTop: 10 }}>
        <label>
          <em>Note with the link</em>
          <textarea value={draft.note} style={{ height: 74 }} onChange={(event) => onDraft({ note: event.target.value })} />
        </label>
        <small aria-hidden="true" data-over={[...draft.note].length > ACCESS_NOTE_MAX || undefined}>
          {[...draft.note].length}/{ACCESS_NOTE_MAX}
        </small>
      </div>
      <p className={styles.dgNote}>Only shown after payment. Use a link meant for buyers, like an unlisted YouTube playlist, a private Notion page or a Google Drive folder.</p>
    </div>
  );
}

function CodesPanel({ item, api, ready, patchItem }: PanelProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const left = item?.delivery === 'CODES' ? item.codesLeft : 0;
  const pasted = parseCodes(text).length;

  async function add() {
    setError('');
    setResult('');
    setBusy(true);
    try {
      const current = await ready('CODES');
      if (!current) return setError(NOT_YET);
      const { added, left: now } = await api.addCodes(current.id, text);
      patchItem((cur) => ({ ...cur, codesLeft: now }));
      setText('');
      const old = pasted - added;
      setResult(old <= 0 ? `Added ${added}.` : `Added ${added}. ${old} ${old === 1 ? 'was' : 'were'} already there.`);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.dg}>
      <label className={`${ui.float} ${styles.mono}`}>
        <em>Codes, one per line</em>
        <textarea
          value={text}
          style={{ height: 132, fontSize: 13 }}
          placeholder={item ? 'Paste new codes here' : undefined}
          disabled={!item}
          title={item ? undefined : NEEDS_ITEM}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className={styles.dgCount} aria-live="polite">
        <b>
          {left} {left === 1 ? 'code' : 'codes'}
        </b>
        <span>left to give out</span>
      </p>
      <button type="button" className={ui.primaryButton} disabled={!item || busy || pasted === 0} onClick={() => void add()}>
        {pasted === 0 ? 'Add codes' : `Add ${pasted} ${pasted === 1 ? 'code' : 'codes'}`}
      </button>
      {result ? (
        <p className={styles.dgHint} role="status">
          {result}
        </p>
      ) : null}
      {error ? <Callout tone="error">{error}</Callout> : null}
      <p className={styles.dgNote}>Each buyer gets one code nobody else gets. When they run out, the item shows Sold out until you add more.</p>
    </div>
  );
}

const sorted = (sessions: EditorItem['sessions']) => [...sessions].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
const asRow = (s: StoredSession): EditorItem['sessions'][number] => ({ id: s.id, startsAt: new Date(s.startsAt), seats: s.seats, booked: s.booked, seatsLeft: s.seatsLeft });
const seatCount = (text: string) => (/^\d{1,5}$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 10_000 ? Number(text) : null);
const SEATS_SENTENCE = 'Seats are a whole number from 1 to 10,000.';

function SessionPanel({ item, api, patchItem, draft, onDraft }: PanelProps & DraftProps) {
  const [adding, setAdding] = useState(false);
  const check = checkDigital(draft);
  const online = draft.place === 'ONLINE';
  const stored = item?.kind === 'DIGITAL' && item.delivery === 'SESSION';
  const sessions = stored ? item.sessions : [];
  // Times can only be added once the item is saved as a session item, which needs how long and where.
  const why = !item
    ? NEEDS_ITEM
    : stored
      ? undefined
      : 'error' in check
        ? 'Say how long it runs and where first'
        : 'Saving how long it runs and where. Add times in a moment';

  return (
    <div className={styles.dg}>
      {sessions.length > 0 ? (
        <>
          <p className={styles.dgHead}>
            <span>Date</span>
            <span>Time</span>
            <span>Seats</span>
            <span />
          </p>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} itemId={item?.id ?? ''} api={api} patchItem={patchItem} />
          ))}
        </>
      ) : null}
      {adding && stored ? <NewTime itemId={item.id} api={api} patchItem={patchItem} seats={sessions.at(-1)?.seats} onDone={() => setAdding(false)} /> : null}
      {adding && stored ? null : (
        <button type="button" className={ui.addRow} disabled={Boolean(why)} title={why} onClick={() => setAdding(true)}>
          + Add a time
        </button>
      )}
      <p className={styles.dgNote}>Times are in Malaysia time.</p>

      <div className={styles.grid2} style={{ marginTop: 10 }}>
        <label className={ui.float}>
          <em>How long</em>
          <input value={draft.minutes} placeholder="90 minutes" autoComplete="off" onChange={(event) => onDraft({ minutes: event.target.value })} />
        </label>
        <div className={`${styles.pricedBy} ${styles.dgWhere}`} role="radiogroup" aria-label="Where" style={{ '--at': online ? 0 : 1 } as CSSProperties}>
          {(
            [
              ['ONLINE', 'Online'],
              ['IN_PERSON', 'In person'],
            ] as const
          ).map(([place, label]) => (
            <button key={place} type="button" role="radio" aria-checked={draft.place === place} onClick={() => draft.place !== place && onDraft({ place })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {online ? (
        <label className={`${ui.float} ${styles.mono}`} style={{ marginTop: 10 }}>
          <em>Meeting link, sent after they pay</em>
          <input value={draft.meet} autoComplete="off" onChange={(event) => onDraft({ meet: event.target.value })} />
        </label>
      ) : (
        <label className={ui.float} style={{ marginTop: 10 }}>
          <em>Where, sent after they pay</em>
          <input value={draft.venue} autoComplete="off" onChange={(event) => onDraft({ venue: event.target.value })} />
        </label>
      )}
      {(draft.minutes.trim() !== '' || draft.meet.trim() !== '' || draft.venue.trim() !== '') && 'error' in check ? (
        <p className={styles.dgHint} role="alert">
          {check.error}
        </p>
      ) : null}
      <p className={styles.dgNote}>Buyers pick a time. Each booking takes a seat, and a full time can&rsquo;t be picked. They get a reminder email the day before.</p>
    </div>
  );
}

type RowProps = { itemId: string; api: ItemsApi; patchItem: PanelProps['patchItem'] };

function SessionRow({ session, itemId, api, patchItem }: RowProps & { session: EditorItem['sessions'][number] }) {
  const start = toMalaysia(session.startsAt);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [seats, setSeats] = useState(String(session.seats));
  const [error, setError] = useState('');
  const booked = session.booked > 0;

  async function save() {
    const instant = toInstant(date, time);
    if (!instant) return setError('Pick a date and a time.');
    const count = seatCount(seats);
    if (count === null) return setError(SEATS_SENTENCE);
    // A booked time stays where it is; only its seats move.
    const patch: { startsAt?: string; seats?: number } = {};
    if (!booked && (date !== start.date || time !== start.time)) patch.startsAt = instant;
    if (count !== session.seats) patch.seats = count;
    if (Object.keys(patch).length === 0) return setError('');
    try {
      const next = asRow(await api.updateSession(itemId, session.id, patch));
      patchItem((cur) => ({ ...cur, sessions: sorted(cur.sessions.map((s) => (s.id === next.id ? next : s))) }));
      setError('');
    } catch (failure) {
      setError(message(failure));
    }
  }

  async function remove() {
    try {
      await api.removeSession(itemId, session.id);
      patchItem((cur) => ({ ...cur, sessions: cur.sessions.filter((s) => s.id !== session.id) }));
    } catch (failure) {
      setError(message(failure));
    }
  }

  const lock = booked ? 'A time with bookings cannot be moved. Its seats can still change.' : undefined;
  const enter = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div className={styles.dgRow} role="group" aria-label={`Time: ${timeLabel(session.startsAt)}`}>
      <div className={styles.dgSlot}>
        <input type="date" value={date} aria-label="Date" disabled={booked} title={lock} onChange={(e) => setDate(e.target.value)} onBlur={() => void save()} onKeyDown={enter} />
        <input type="time" value={time} aria-label="Time" disabled={booked} title={lock} onChange={(e) => setTime(e.target.value)} onBlur={() => void save()} onKeyDown={enter} />
        <span className={styles.dgSeat}>
          <input value={seats} inputMode="numeric" aria-label="Seats" onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ''))} onBlur={() => void save()} onKeyDown={enter} />
          <small>{session.booked} booked</small>
        </span>
        <button
          type="button"
          className={ui.iconButton}
          aria-label="Remove this time"
          disabled={booked}
          title={booked ? `${session.booked} booked, so this time cannot be removed` : undefined}
          onClick={() => void remove()}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {error ? (
        <p className={styles.dgHint} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function NewTime({ itemId, api, patchItem, seats: lastSeats, onDone }: RowProps & { seats?: number; onDone: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState(String(lastSeats ?? 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const instant = toInstant(date, time);
    if (!instant) return setError('Pick a date and a time.');
    const count = seatCount(seats);
    if (count === null) return setError(SEATS_SENTENCE);
    setBusy(true);
    try {
      const next = asRow(await api.addSession(itemId, { startsAt: instant, seats: count }));
      patchItem((cur) => ({ ...cur, sessions: sorted([...cur.sessions, next]) }));
      onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.dgRow} role="group" aria-label="A new time">
      <div className={`${styles.dgSlot} ${styles.dgNew}`}>
        <input type="date" value={date} aria-label="New date" min={toMalaysia(new Date()).date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" value={time} aria-label="New time" onChange={(e) => setTime(e.target.value)} />
        <span className={styles.dgSeat}>
          <input value={seats} inputMode="numeric" aria-label="New seats" onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ''))} />
          <small>seats</small>
        </span>
        <span className={styles.dgNewActions}>
          <button type="button" className={ui.primaryButton} disabled={busy} onClick={() => void add()}>
            Add
          </button>
          <button type="button" className={styles.ghost} onClick={onDone}>
            Cancel
          </button>
        </span>
      </div>
      {error ? (
        <p className={styles.dgHint} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
