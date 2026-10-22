'use client';

import { useState, type CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { PageCard } from './PageCard.js';
import { PERSONAS } from './personas.js';
import styles from './tanya.module.css';

/**
 * Who it's for: five kinds of owner. Pointing at one (or focusing it) slides
 * its band in, with the questions their visitors ask running across it, and
 * the page beside the list becomes theirs.
 */
export function Who({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [on, setOn] = useState(0);
  const row = copy.who.rows[on]!;
  const person = PERSONAS[row.key];
  const words = copy.personas[row.key];

  return (
    <section id="who" className={styles.who}>
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>{copy.who.eyebrow}</p>
        <h2 className={styles.h2}>{copy.who.title}</h2>
        <p className={styles.lede}>{copy.who.lede}</p>

        <div className={styles.whoGrid}>
          <ul className={styles.whoList}>
            {copy.who.rows.map((r, i) => {
              const p = PERSONAS[r.key];
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    className={styles.fmRow}
                    aria-pressed={i === on}
                    onMouseEnter={() => setOn(i)}
                    onFocus={() => setOn(i)}
                    onClick={() => setOn(i)}
                  >
                    <span className={styles.fmLabel}>
                      <span>{r.label}</span>
                      <small>curios.my/{p.handle}</small>
                    </span>
                    <span className={styles.fmBand} aria-hidden="true" style={{ background: p.accent }}>
                      <span className={styles.fmTrack}>
                        {[...r.qs, ...r.qs].map((q, k) => (
                          <span key={k}>
                            {q}
                            <span className={styles.fmDot} />
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <figure className={styles.whoStage} aria-label={copy.who.pageOf(person.name)} style={{ margin: 0 }}>
            <PageCard
              persona={person}
              words={words}
              view="links"
              icons={false}
              labels={{ links: copy.hero.linksTab, ask: copy.hero.askTab, askAnything: copy.hero.askAnything, reply: copy.hero.replyLabel }}
              className={styles.whoCard}
            />
            <p className={`${styles.float} ${styles.floatQ}`}>{words.q}</p>
            <p className={`${styles.float} ${styles.floatA}`} style={{ '--float-dot': person.accent } as CSSProperties}>
              <span className={styles.floatWho}>{copy.hero.replyLabel(person.name)}</span>
              {words.a}
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
