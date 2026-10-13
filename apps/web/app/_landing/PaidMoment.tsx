import type { LandingCopy } from './copy.js';
import { PaidStage } from './PaidStage.js';
import base from './landing.module.css';
import styles from './paid.module.css';

/** What Business pays for, as five steps on one phone, pinned while the captions move past. */
export function PaidMoment({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandBiru} ${styles.paid}`} id="paid" aria-labelledby="paid-title">
      <PaidStage
        leads={copy.leads}
        shop={copy.shop}
        progressLabel={copy.paid.progressLabel}
        captions={
          <div className={styles.copy}>
            <h2 id="paid-title" className={base.h2}>{copy.paid.title}</h2>
            <ol className={styles.track}>
              {copy.leads.steps.map((step, i) => (
                <li key={step.title} className={styles.panel} data-panel={i + 1}>
                  <span className={styles.number} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className={styles.title}>{step.title}</h3>
                  <p className={styles.body}>{step.body}</p>
                </li>
              ))}
            </ol>
            <p className={styles.closing}>{copy.paid.closing}</p>
          </div>
        }
      />
    </section>
  );
}
