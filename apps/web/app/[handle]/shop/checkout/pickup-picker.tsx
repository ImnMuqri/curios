'use client';

import { useEffect, useRef, useState } from 'react';
import { windowLabel } from '@curios/core/pickup';
import type { PublicPickupPlace } from '@curios/db-read';
import { apiFetch } from '../../../../lib/api.js';
import type { ShopCopy } from '../copy.js';
import styles from './checkout.module.css';

/** A place's times on one day, as the API answers: `full` when its limit is reached. */
type Times = { id: string; from: number; to: number; full: boolean }[];

export interface PickupPickerProps {
  copy: ShopCopy;
  handle: string;
  /** The shop's places, at least one (a shop with none takes pickup at any time, with no picker). */
  places: PublicPickupPlace[];
  /** The day picked above, `YYYY-MM-DD`; times are only asked for once there is one. */
  day: string | null;
  placeId: string | null;
  windowId: string | null;
  onPlace: (id: string) => void;
  onWindow: (id: string | null) => void;
  /** Bumped by checkout to ask for the times again: a time filled up, or went, under the customer. */
  refresh?: number;
}

/**
 * Where and when to collect: the place (a choice only when there are several)
 * and, at a place with set times, one of its times on the picked day. Checkout
 * holds the picks; this asks the API which times are full and draws them.
 */
export function PickupPicker({ copy, handle, places, day, placeId, windowId, onPlace, onWindow, refresh = 0 }: PickupPickerProps) {
  const place = places.find((p) => p.id === placeId) ?? null;
  // The times on show belong to one place on one day.
  const key = place && !place.anyTime && day !== null ? `${place.id}/${day}` : null;
  const [times, setTimes] = useState<{ key: string; list: Times } | null>(null);
  const [failed, setFailed] = useState(false);
  // Read inside effects that must not re-run when a new callback or pick arrives.
  const latest = useRef({ windowId, onWindow });
  latest.current = { windowId, onWindow };

  // A time is for one place on one day: another place or day clears it.
  const shownFor = useRef(key);
  useEffect(() => {
    if (shownFor.current === key) return;
    shownFor.current = key;
    latest.current.onWindow(null);
  }, [key]);

  useEffect(() => {
    if (!place || key === null || day === null) return;
    let live = true;
    setFailed(false);
    apiFetch<{ windows: Times }>(`/store/${encodeURIComponent(handle)}/pickup-times?place=${encodeURIComponent(place.id)}&day=${day}`)
      .then(({ windows }) => {
        if (!live) return;
        setTimes({ key, list: windows });
        // The picked time filled up or went since it was picked: it is picked no longer.
        const picked = latest.current.windowId;
        if (picked !== null && !windows.some((w) => w.id === picked && !w.full)) latest.current.onWindow(null);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // `place` and `day` are read through `key`, which changes with either.
  }, [handle, key, refresh]);

  const mapLink = (p: PublicPickupPlace) =>
    p.mapUrl ? (
      <a className={styles.mapLink} href={p.mapUrl} target="_blank" rel="noopener noreferrer" aria-label={`${copy.pickupMap}: ${p.name}`}>
        {copy.pickupMap}
      </a>
    ) : null;
  const shown = times && times.key === key ? times.list : null;

  return (
    <div className={styles.pickup}>
      <div className={`${styles.head} ${styles.dayHead}`}>
        <h2 id="ck-where">{copy.pickupWhere}</h2>
      </div>
      {places.length > 1 ? (
        <div className={styles.methods} role="radiogroup" aria-labelledby="ck-where">
          {places.map((p) => (
            <div key={p.id} className={styles.place}>
              <button type="button" role="radio" aria-checked={p.id === placeId} className={styles.method} onClick={() => onPlace(p.id)}>
                <i className={styles.radio} aria-hidden="true" />
                <span className={styles.methodText}>
                  <b>{p.name}</b>
                  <span>{p.address}</span>
                </span>
              </button>
              {mapLink(p)}
            </div>
          ))}
        </div>
      ) : place ? (
        <div className={`${styles.methods} ${styles.place}`}>
          <span className={styles.method}>
            <span className={styles.methodText}>
              <b>{place.name}</b>
              <span>{place.address}</span>
            </span>
          </span>
          {mapLink(place)}
        </div>
      ) : null}
      {place?.note ? <p className={styles.placeNote}>{place.note}</p> : null}

      {place === null ? null : place.anyTime ? (
        <>
          <div className={`${styles.head} ${styles.dayHead}`}>
            <h2>{copy.pickupTime}</h2>
          </div>
          <p className={styles.anyTime}>{copy.pickupAnyTime}</p>
        </>
      ) : failed ? (
        <p className={styles.error}>{copy.failed}</p>
      ) : shown ? (
        <>
          <div className={`${styles.head} ${styles.dayHead}`}>
            <h2 id="ck-time">{copy.pickupTime}</h2>
          </div>
          <div className={styles.days} role="radiogroup" aria-labelledby="ck-time">
            {shown.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={w.id === windowId}
                disabled={w.full}
                className={styles.day}
                onClick={() => onWindow(w.id)}
              >
                {w.full ? `${windowLabel(w.from, w.to)} · ${copy.pickupFull}` : windowLabel(w.from, w.to)}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
