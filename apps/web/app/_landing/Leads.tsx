import type { LandingCopy } from './copy.js';
import { LeadsStory } from './LeadsStory.js';
import { Reveal } from './Reveal.js';
import base from './landing.module.css';
import styles from './leads.module.css';

/**
 * The part a business pays for, played out once: a customer's question at
 * 11:42 at night becomes an email with their number, the order and a reply
 * already typed. Answers objection three -- "why pay when answering is free?"
 * -- by showing exactly what the money buys.
 */
export function Leads({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandBiru} ${styles.leads}`} aria-labelledby="leads-title">
      <div className={base.wrap}>
        <Reveal>
          <h2 id="leads-title" className={base.h2}>
            {copy.leads.title}
          </h2>
          <p className={base.lede}>{copy.leads.intro}</p>
        </Reveal>
        <LeadsStory copy={copy.leads} shop={copy.shop} />
        <p className={styles.footnote}>{copy.leads.footnote}</p>
      </div>
    </section>
  );
}
