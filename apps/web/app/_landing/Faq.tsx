import type { LandingCopy } from './copy.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './faq.module.css';

/**
 * Native details/summary: keyboard and screen-reader behaviour for free, and
 * every answer is in the HTML for search engines and for the FAQPage
 * structured data, which is built from this same list.
 */
export function Faq({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandSurface} ${styles.faq}`} id="faq" aria-labelledby="faq-title">
      <div className={`${base.wrap} ${styles.grid}`}>
        <Reveal>
          <h2 id="faq-title" className={base.h2}>
            {copy.faq.title}
          </h2>
        </Reveal>
        <div className={styles.list}>
          {copy.faq.items.map((item) => (
            <details key={item.q} className={styles.item}>
              <summary className={styles.q}>
                <span>{item.q}</span>
                <span className={styles.sign} aria-hidden="true" />
              </summary>
              <p className={styles.a}>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
