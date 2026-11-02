'use client';

import { useEffect, useRef, useState } from 'react';
import { windowLabel } from '@curios/core/pickup';
import type { PublicPickupPlace } from '@curios/db-read';
import { apiFetch } from '../../../../lib/api.js';
import type { ShopCopy } from '../copy.js';
import styles from './checkout.module.css';

/*
 * Where and when to collect, in the spec's order: the place (PickupWhere, above
 * the day pills), then the day, then one of the place's times on that day
 * (PickupTime, under them). Checkout holds the picks; these draw them.
 */

/** A place's times on one day, as the API answers: `full` when its limit is reached. */
type Times = { id: string; from: number; to: number; full: boolean }[];

export interface PickupWhereProps {
  copy: ShopCopy;
  /** The shop's places, at least one (a shop with none takes pickup at any time, with no picker). */
  places: PublicPickupPlace[];
  placeId: string | null;
  onPlace: (id: string) => void;
}

/** The place: a choice only when there are several, else the one place as text. */
export function PickupWhere({ copy, places, placeId, onPlace }: PickupWhereProps) {
  const place = places.find((p) => p.id === placeId) ?? null;
  const mapLink = (p: PublicPickupPlace) =>
    p.mapUrl ? (
      <a className={styles.mapLink} href={p.mapUrl} target="_blank" rel="noopener noreferrer" aria-label={`${copy.pickupMap}: ${p.name}`}>
        {copy.pickupMap}
      </a>
    ) : null;

  return (
    <div>
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
    </div>
  );
}

export interface PickupTimeProps {
  copy: ShopCopy;
  handle: string;
  /** The picked place; null draws nothing. */
  place: PublicPickupPlace | null;
  /** The day picked, `YYYY-MM-DD`; times are only asked for once there is one. */
  day: string | null;
  windowId: string | null;
  onWindow: (id: string | null) => void;
  /** Bumped by checkout to ask for the times again: a time filled up, or went, under the customer. */
  refresh?: number;
}

/**
 * The time: "Any time that day" at a place without set times; else, once a day
 * is picked, the place's times that day from the API, a full one not pickable.
 */
export function PickupTime({ copy, handle, place, day, windowId, onWindow, refresh = 0 }: PickupTimeProps) {
  // The times on show belong to one place on one day.
  const key = place && !place.anyTime && day !== null ? `${place.id}/${day}` : null;
  const [times, setTimes] = useState<{ key: string; list: Times } | null>(null);
  const [failed, setFailed] = useState(false);
  /** Bumped by "Try again" after the times could not be read. */
  const [tries, setTries] = useState(0);
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
  }, [handle, key, refresh, tries]);

  if (place === null) return null;
  if (place.anyTime) {
    return (
      <>
        <div className={`${styles.head} ${styles.dayHead}`}>
          <h2>{copy.pickupTime}</h2>
        </div>
        <p className={styles.anyTime}>{copy.pickupAnyTime}</p>
      </>
    );
  }
  if (failed) {
    return (
      <div>
        <p className={styles.error} role="alert">
          {copy.pickupTimesFailed}
        </p>
        <button type="button" className={styles.codeLink} onClick={() => setTries((n) => n + 1)}>
          {copy.tryAgain}
        </button>
      </div>
    );
  }
  const shown = times && times.key === key ? times.list : null;
  if (!shown) return null;
  return (
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
  );
}
