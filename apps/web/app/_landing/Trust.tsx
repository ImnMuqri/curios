import type { CSSProperties } from 'react';
import type { LandingCopy } from './copy.js';
import { InView } from './InView.js';
import { Reveal } from './Reveal.js';
import { DEMO_SHOP } from './demo.js';
import base from './landing.module.css';
import styles from './trust.module.css';

/**
 * Objection one: "it will quote a wrong price and embarrass me." One picture
 * makes the case: the shop's price list, the only prices it may say, and
 * under it the one exchange where it is asked something not on the list and
 * says it will check.
 */
export function Trust({ copy }: { copy: LandingCopy }) {
  const t = copy.trust;
  const { facts: DEMO_FACTS, priceList: DEMO_PRICE_LIST } = copy.shop;
  return (
    <section className={`${base.bandKuning} ${styles.trust}`} aria-labelledby="trust-title">
      <div className={`${base.wrap} ${styles.grid}`}>
        <Reveal className={styles.text}>
          <h2 id="trust-title" className={base.h2}>
            {t.title}
          </h2>
          <p className={base.lede}>{t.body}</p>
        </Reveal>

        {/* Plays once on arrival: each line's dots run out to its price, then the question, typing, the answer. */}
        <InView className={styles.visual}>
          <div className={styles.list}>
            <p className={styles.shop}>{DEMO_SHOP}</p>
            <p className={styles.listTitle}>{DEMO_PRICE_LIST}</p>
            <dl className={styles.prices}>
              {DEMO_FACTS.map((fact, i) => (
                <div key={fact.claim} className={styles.line} style={{ '--i': i } as CSSProperties}>
                  <dt>{fact.claim}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.approved}>{t.approvedBy}</p>
          </div>
          <div className={styles.exchange} aria-label={`${t.unsureQuestion} ${t.unsureAnswer}`} role="group">
            <p className={styles.q}>{t.unsureQuestion}</p>
            <p className={styles.typing} aria-hidden="true">
              <span />
              <span />
              <span />
            </p>
            <p className={styles.a}>{t.unsureAnswer}</p>
          </div>
        </InView>
      </div>
    </section>
  );
}
