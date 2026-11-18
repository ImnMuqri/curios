import type { CSSProperties } from 'react';
import { COPY, type Locale } from './copy.js';
import { BioArt, FactsArt, PasteArt } from './how-scenes.js';
import calm from './calm.module.css';
import styles from './how.module.css';

const ARTS = [PasteArt, FactsArt, BioArt];

/**
 * How it works (Landing2 board): three cards, each playing its step once it
 * is in view. Paste a few paragraphs and the facts are marked; approve them
 * one by one; tap the link in the bio and the page answers. The server, and
 * reduced motion, show each card's finished frame.
 */
export function How({ locale }: { locale: Locale }) {
  const copy = COPY[locale].how;
  return (
    <section className={calm.sec} id="how" aria-labelledby="how-title">
      <div className={calm.wrap}>
        <p className={`${calm.lbl} ${calm.rv}`} data-rv="">
          {copy.eyebrow}
        </p>
        <h2 id="how-title" className={`${calm.h2} ${calm.rv}`} data-rv="">
          {copy.title}
        </h2>
        <ol className={styles.cards3}>
          {copy.steps.map((step, i) => {
            const Art = ARTS[i]!;
            return (
              <li key={step.title} className={`${styles.card} ${calm.rv}`} data-rv="" style={{ '--d': `${i * 120}ms` } as CSSProperties}>
                <Art locale={locale} />
                <div className={styles.cb}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
