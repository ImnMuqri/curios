import type { LandingCopy } from './copy.js';
import styles from './tanya.module.css';

/** Questions an owner asks before signing up. The same items feed the page's FAQPage structured data. */
export function Faq({ copy }: { copy: LandingCopy['faq'] }) {
  return (
    <section id="faq" className={styles.faq}>
      <div className={`${styles.wrap} ${styles.faqGrid}`}>
        <h2 className={styles.h2}>{copy.title}</h2>
        <div className={styles.faqList}>
          {copy.items.map((item, i) => (
            <details key={item.q} className={styles.q} open={i === 0}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
