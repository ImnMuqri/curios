'use client';

import type { CSSProperties, ReactNode } from 'react';
import styles from './stat-strip.module.css';

export interface StatCard {
  /** React key; also what a test or a page finds the card by. */
  id: string;
  label: string;
  value: ReactNode;
  /** A small green line under the value ("+RM235 today"). */
  line?: ReactNode;
  /**
   * What the line says about the figure: `up` (green), or `down` / `flat` (muted). Left out it is `up`, so a card whose line is
   * always a gain (Orders' "+RM235 today") need not say so; a line that can be a loss or no change must pass `changeTone(...)`.
   */
  lineTone?: 'up' | 'down' | 'flat';
  /** The card's own call to action at its foot ("Check it →"). */
  go?: ReactNode;
  /** The one thing waiting on the owner: tinted, and put first by the page. */
  urgent?: boolean;
  /** Makes the card a toggle for this list filter (a `<button aria-pressed>`). */
  filter?: string;
  /** Seven days, oldest first, today last: drawn as a small bar chart top-right. */
  spark?: readonly number[];
  /** 0..1: a thin bar under the value. */
  rate?: number;
}

/** The tone of a line that reports a change: a rise is `up`, a fall `down`, no change `flat`. */
export function changeTone(diff: number): 'up' | 'down' | 'flat' {
  return diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
}

/**
 * The inbox screens' three stat cards (Dash.html `.stats.xsts` / `.st3`). A card with a `filter`
 * is a button that narrows the list below to it; pressing the pressed one again clears it, so
 * `onFilter` gets `null`. `active` is the filter the page has on now (one rule with the chips).
 * On a phone the strip scrolls sideways, a card and a bit at a time.
 */
export function StatStrip({
  cards,
  active = null,
  onFilter,
  label,
}: {
  cards: readonly StatCard[];
  active?: string | null;
  onFilter?: (filter: string | null) => void;
  /** An accessible name for the group, when the page has one to give. */
  label?: string;
}) {
  return (
    <div className={styles.strip} style={{ '--n': cards.length } as CSSProperties} role="group" aria-label={label}>
      {cards.map((card) => {
        const body = (
          <>
            <small className={styles.label}>{card.label}</small>
            <b className={styles.value}>{card.value}</b>
            {card.line ? <em className={styles.line} data-tone={card.lineTone}>{card.line}</em> : null}
            {card.rate !== undefined ? (
              <span className={styles.bar} aria-hidden="true">
                <u style={{ width: `${Math.round(Math.min(1, Math.max(0, card.rate)) * 100)}%` }} />
              </span>
            ) : null}
            {card.go ? <span className={styles.go}>{card.go}</span> : null}
            {card.spark ? <Spark values={card.spark} /> : null}
          </>
        );
        const className = [styles.card, card.urgent ? styles.urgent : ''].filter(Boolean).join(' ');
        if (card.filter === undefined) {
          return (
            <div key={card.id} className={className}>
              {body}
            </div>
          );
        }
        const filter = card.filter;
        const pressed = active === filter;
        return (
          <button
            key={card.id}
            type="button"
            className={className}
            aria-pressed={pressed}
            onClick={() => onFilter?.(pressed ? null : filter)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A week at a glance (Dash.html `.spk`): seven 8px bars 4px apart, bottom-aligned in 84x28, each
 * `max(4, round(26 * v / max))` tall, today's (the last) in green. Decoration: the card's value says
 * the number. Hidden on a phone.
 */
export function Spark({ values }: { values: readonly number[] }) {
  const max = Math.max(0, ...values);
  return (
    <svg className={styles.spark} viewBox="0 0 84 28" width="84" height="28" aria-hidden="true" focusable="false">
      {values.map((v, i) => {
        const h = Math.max(4, max > 0 ? Math.round((26 * v) / max) : 0);
        return (
          <rect
            key={i}
            x={i * 12}
            y={28 - h}
            width="8"
            height={h}
            rx="2"
            className={i === values.length - 1 && max > 0 ? styles.today : undefined}
          />
        );
      })}
    </svg>
  );
}
