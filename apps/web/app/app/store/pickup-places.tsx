'use client';

import { useRef, useState, type FormEvent } from 'react';
import { PICKUP_ADDRESS_MAX, PICKUP_LIMIT_MAX, PICKUP_NOTE_MAX, PICKUP_PLACES_MAX, PICKUP_PLACE_NAME_MAX, PICKUP_WINDOWS_MAX, windowLabel, windowProblem } from '@curios/core/pickup';
import { Callout } from '@curios/ui';
import ui from '../_ui/editor.module.css';
import type { PickupApi, PickupPlaceView, PlaceInput } from './store-types.js';
import styles from './store.module.css';

const TICK = 'M5 12.5l4.5 4.5L19 7.5';

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

/** `10:00` from an `<input type="time">`, as minutes after midnight; anything else is NaN, which the rule refuses. */
function minutesOf(text: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

/** Minutes back as `HH:MM`. A window that ends at midnight (1440) is shown as 23:59, the latest a time field holds; `endOf` turns it back. */
function clockOf(minutes: number): string {
  const m = Math.min(minutes, 1439);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** An end time as minutes: 23:59 is the field's midnight, so it goes on as 1440 and an edit never moves a window that ends then. */
const endOf = (text: string) => (text === '23:59' ? 1440 : minutesOf(text));

/** A blank limit is none; text that is not a whole number goes on as NaN, for the rule to refuse. */
const limitOf = (text: string) => (text.trim() === '' ? null : /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

type WindowDraft = { key: number; id?: string; from: string; to: string; limit: string };
type Draft = { name: string; address: string; mapUrl: string; note: string; anyTime: boolean; windows: WindowDraft[] };

let keys = 0;
const blankWindow = (): WindowDraft => ({ key: ++keys, from: '', to: '', limit: '' });
const blank = (): Draft => ({ name: '', address: '', mapUrl: '', note: '', anyTime: true, windows: [] });

function draftOf(place: PickupPlaceView): Draft {
  return {
    name: place.name,
    address: place.address,
    mapUrl: place.mapUrl ?? '',
    note: place.note ?? '',
    anyTime: place.anyTime,
    windows: place.windows.map((w) => ({ key: ++keys, id: w.id, from: clockOf(w.from), to: clockOf(w.to), limit: w.limit === null ? '' : String(w.limit) })),
  };
}

function windowsOf(draft: Draft): NonNullable<PlaceInput['windows']> {
  return draft.windows.map((w) => ({ ...(w.id ? { id: w.id } : {}), from: minutesOf(w.from), to: endOf(w.to), limit: limitOf(w.limit) }));
}

function inputOf(draft: Draft): PlaceInput {
  return {
    name: draft.name.trim(),
    address: draft.address.trim(),
    mapUrl: draft.mapUrl.trim() === '' ? null : draft.mapUrl.trim(),
    note: draft.note.trim() === '' ? null : draft.note.trim(),
    anyTime: draft.anyTime,
    windows: draft.anyTime ? [] : windowsOf(draft),
  };
}

/** "Any time", or "10am–12pm · 2pm–4pm (up to 5)". */
const timesWords = (place: PickupPlaceView) =>
  place.anyTime ? 'Any time' : place.windows.map((w) => `${windowLabel(w.from, w.to)}${w.limit === null ? '' : ` (up to ${w.limit})`}`).join(' · ');

function Tile({ name, note, pressed, onClick }: { name: string; note: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`${ui.tile} ${styles.deliveryTile}`} aria-pressed={pressed} onClick={onClick}>
      <span className={ui.tick} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12">
          <path d={TICK} />
        </svg>
      </span>
      <span>
        <b>{name}</b>
        <span>{note}</span>
      </span>
    </button>
  );
}

/** One text field in the store's floating-label style. */
function Field({ label, optional, value, max, placeholder, onChange }: { label: string; optional?: boolean; value: string; max: number; placeholder?: string; onChange: (text: string) => void }) {
  return (
    <div className={ui.float}>
      <label>
        <em>
          {label}
          {optional ? <i className={styles.optional}> optional</i> : null}
        </em>
        <input aria-label={label} value={value} maxLength={max} placeholder={placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}

/**
 * The place form, to add one or, given `editing`, to change one. The times are checked by the same rule
 * the API applies before anything is sent; an edit sends each kept window's id so it stays the same window.
 */
function PlaceForm({ api, editing, onSaved, onCancel }: { api: PickupApi; editing?: PickupPlaceView; onSaved: (places: PickupPlaceView[]) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : blank()));
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<Draft>) => {
    setDraft((before) => ({ ...before, ...patch }));
    setProblem('');
  };
  const changeWindow = (key: number, patch: Partial<WindowDraft>) => change({ windows: draft.windows.map((w) => (w.key === key ? { ...w, ...patch } : w)) });
  const chooseTimes = () => change({ anyTime: false, windows: draft.windows.length === 0 ? [blankWindow()] : draft.windows });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = inputOf(draft);
    // The API owns the sentence for a name or address; only the times are checked here, as they are the part a form can get tangled.
    const refused = input.anyTime ? null : windowProblem(input.windows);
    if (refused) return setProblem(refused);
    setBusy(true);
    try {
      onSaved(await (editing ? api.save(editing.id, input) : api.add(input)));
    } catch (failure) {
      setProblem(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.voucherForm} onSubmit={(event) => void submit(event)} aria-label={editing ? 'Edit pickup place' : 'New pickup place'} noValidate>
      <Field label="Name" value={draft.name} max={PICKUP_PLACE_NAME_MAX} onChange={(name) => change({ name })} />
      <Field label="Address" value={draft.address} max={PICKUP_ADDRESS_MAX} onChange={(address) => change({ address })} />
      <Field label="Map link" optional value={draft.mapUrl} max={2000} placeholder="https://maps.app.goo.gl/..." onChange={(mapUrl) => change({ mapUrl })} />
      <Field label="Note" optional value={draft.note} max={PICKUP_NOTE_MAX} onChange={(note) => change({ note })} />

      <div className={styles.vGroup} role="group" aria-label="When">
        <Tile name="Any time that day" note="Customers come when they like" pressed={draft.anyTime} onClick={() => change({ anyTime: true })} />
        <Tile name="Set times" note="Only at times you choose" pressed={!draft.anyTime} onClick={chooseTimes} />
      </div>

      {draft.anyTime ? null : (
        <div className={styles.pickupWindows}>
          {draft.windows.map((w) => (
            <div key={w.key} className={styles.pickupWindow}>
              <div className={styles.vField}>
                <span className={styles.vLabel}>From</span>
                <input className={styles.vDate} type="time" aria-label="From" value={w.from} onChange={(event) => changeWindow(w.key, { from: event.target.value })} />
              </div>
              <div className={styles.vField}>
                <span className={styles.vLabel}>To</span>
                <input className={styles.vDate} type="time" aria-label="To" value={w.to} onChange={(event) => changeWindow(w.key, { to: event.target.value })} />
              </div>
              <div className={styles.vField}>
                <span className={styles.vLabel}>
                  Limit <i>optional</i>
                </span>
                <label className={styles.money}>
                  <input value={w.limit} inputMode="numeric" aria-label="Limit" placeholder="No limit" maxLength={String(PICKUP_LIMIT_MAX).length} autoComplete="off" onChange={(event) => changeWindow(w.key, { limit: event.target.value })} />
                </label>
              </div>
              <button type="button" className={styles.ghost} aria-label="Remove this time" onClick={() => change({ windows: draft.windows.filter((other) => other.key !== w.key) })}>
                Remove
              </button>
            </div>
          ))}
          {draft.windows.length < PICKUP_WINDOWS_MAX ? (
            <button type="button" className={ui.addRow} onClick={() => change({ windows: [...draft.windows, blankWindow()] })}>
              + Add a time
            </button>
          ) : null}
        </div>
      )}

      {problem ? (
        <p className={ui.saveError} role="alert">
          {problem}
        </p>
      ) : null}

      <div className={styles.vActions}>
        <button type="submit" className={ui.primaryButton} disabled={busy}>
          {editing ? 'Save place' : 'Add place'}
        </button>
        <button type="button" className={styles.vCancel} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Where customers collect: the owner's pickup places, each open any time that day or at the owner's own
 * times. Every API answer is the whole list, so it replaces what is shown; the list lives in the parent so it survives the screen being hidden. Removing asks inside the page
 * first, and the API's words (the last place cannot go) show in a callout.
 */
export function PickupPlaces({
  places,
  onPlaces: setPlaces,
  api,
  startAdding = false,
  onStopAdding,
}: {
  places: PickupPlaceView[];
  onPlaces: (places: PickupPlaceView[]) => void;
  api: PickupApi;
  /** Opens with the add form showing: pickup being turned on with no place yet. */
  startAdding?: boolean;
  /** The add form closed, by cancel or by saving. */
  onStopAdding?: () => void;
}) {
  const [adding, setAddingState] = useState(startAdding);
  const setAdding = (next: boolean) => {
    setAddingState(next);
    if (!next) onStopAdding?.();
  };
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A second click before the next render must not send a second request.
  const inFlight = useRef(false);

  async function run(call: () => Promise<PickupPlaceView[]>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      setPlaces(await call());
    } catch (failure) {
      setError(message(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setConfirming(null);
    }
  }

  const move = (index: number, delta: -1 | 1) => {
    const ids = places.map((p) => p.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + delta, 0, moved);
    return run(() => api.reorder(ids));
  };

  return (
    <div className={styles.pickupPlaces}>
      {places.length > 0 ? (
        <ul className={styles.itemList}>
          {places.map((place, index) => {
            if (editing === place.id) {
              return (
                <li key={place.id} className={`${styles.voucher} ${styles.vEditRow}`} aria-label={place.name}>
                  <PlaceForm
                    api={api}
                    editing={place}
                    onCancel={() => setEditing(null)}
                    onSaved={(next) => {
                      setPlaces(next);
                      setEditing(null);
                    }}
                  />
                </li>
              );
            }
            return (
              <li key={place.id} className={styles.voucher} aria-label={place.name}>
                <span className={styles.voucherText}>
                  <b>{place.name}</b>
                  <span className={styles.voucherMeta}>
                    <span>{place.address}</span>
                    <span>{timesWords(place)}</span>
                  </span>
                </span>
                {confirming === place.id ? (
                  <span className={ui.confirm} role="group" aria-label="Confirm remove">
                    Remove it? Past orders keep its name and address.
                    <button type="button" className={ui.confirmRemove} disabled={busy} onClick={() => void run(() => api.remove(place.id))}>
                      Yes, remove
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <>
                    <button type="button" className={styles.pickupMove} aria-label={`Move ${place.name} up`} disabled={busy || index === 0} onClick={() => void move(index, -1)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M6 14l6-6 6 6" />
                      </svg>
                    </button>
                    <button type="button" className={styles.pickupMove} aria-label={`Move ${place.name} down`} disabled={busy || index === places.length - 1} onClick={() => void move(index, 1)}>
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M6 10l6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.vCancel}
                      aria-label={`Edit ${place.name}`}
                      disabled={busy}
                      onClick={() => {
                        setAdding(false);
                        setEditing(place.id);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className={styles.ghost} aria-label={`Remove ${place.name}`} disabled={busy} onClick={() => setConfirming(place.id)}>
                      Remove
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {adding ? (
        <PlaceForm
          api={api}
          onCancel={() => setAdding(false)}
          onSaved={(next) => {
            setPlaces(next);
            setAdding(false);
          }}
        />
      ) : null}

      {error ? <Callout tone="error">{error}</Callout> : null}

      {!adding && places.length < PICKUP_PLACES_MAX ? (
        <button
          type="button"
          className={ui.addRow}
          onClick={() => {
            setEditing(null);
            setAdding(true);
          }}
        >
          + Add pickup place
        </button>
      ) : null}
    </div>
  );
}
