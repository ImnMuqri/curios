import type { LandingCopy } from './copy.js';
import { BusinessPrice } from './BusinessPrice.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './pricing.module.css';

/**
 * Objection three, in numbers. Two plans, and they are not presented as
 * equals: Personal is a white card, Business the wider biru one.
 */
export function Pricing({ copy }: { copy: LandingCopy }) {
  const { personal, business } = copy.pricing;
  return (
    <section className={`${base.bandSurface} ${styles.pricing}`} id="pricing" aria-labelledby="pricing-title">
      <div className={base.wrap}>
        <Reveal>
          <h2 id="pricing-title" className={base.h2}>
            {copy.pricing.title}
          </h2>
        </Reveal>
        <div className={styles.plans}>
          <Reveal className={styles.personal}>
            <h3 className={styles.name}>{personal.name}</h3>
            <p className={styles.free}>{personal.price}</p>
            <p className={styles.blurb}>{personal.blurb}</p>
            <ul className={styles.points}>
              {personal.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <a href="/signup" className={`${base.buttonGhost} ${styles.planCta}`}>
              {personal.cta}
            </a>
          </Reveal>

          <Reveal className={`${base.bandBiru} ${styles.business}`} delay={80}>
            <h3 className={styles.name}>{business.name}</h3>
            <BusinessPrice business={business} />
            <p className={styles.trial}>{business.trial}</p>
            <ul className={styles.points}>
              {business.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <a href="/signup" className={`${base.button} ${styles.planCta}`}>
              {business.cta}
            </a>
          </Reveal>
        </div>
        <div className={styles.terms}>
          <p className={styles.math}>{copy.pricing.math}</p>
          <p className={styles.payment}>{copy.pricing.payment}</p>
        </div>
      </div>
    </section>
  );
}
