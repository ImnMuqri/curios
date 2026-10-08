import type { CSSProperties } from 'react';
import type { LandingCopy } from './copy.js';
import { DEMO_PAGE, DEMO_QA, DEMO_SHOP, STORM_WORDINGS } from './demo.js';
import { Device } from './Device.js';
import { StormStage } from './StormStage.js';
import base from './landing.module.css';
import styles from './storm.module.css';

/**
 * The page's one orchestrated moment. Customers' messages -- forty ways of
 * asking one price -- pop up around a phone one by one as the visitor
 * scrolls, then all fly into it: on the phone they are one question, "asked
 * 40×" the way the Questions screen counts it, with the owner's one answer.
 *
 * Server-rendered text; the client stage only moves things and counts.
 */
export function Storm({ copy }: { copy: LandingCopy }) {
  const first = DEMO_QA[0]!;
  const total = STORM_WORDINGS.length;
  const askedLabels = Array.from({ length: total + 1 }, (_, n) => copy.storm.asked(n));

  return (
    <section className={`${base.bandInk} ${styles.storm}`} id="storm" aria-labelledby="storm-title">
      <StormStage
        wordings={STORM_WORDINGS}
        askedLabels={askedLabels}
        phone={
          <div
            className={styles.phone}
            // Kek Lina's own colours, the same page the hero shows.
            style={{ '--accent': DEMO_PAGE.accentColor, '--shop-bg': DEMO_PAGE.backgroundColor } as CSSProperties}
          >
            <Device time="3:15" chrome="browser" url={`curios.my/${DEMO_PAGE.handle}`}>
              <div className={styles.screen}>
                <p className={styles.shop}>
                  {DEMO_PAGE.avatarUrl ? <img src={DEMO_PAGE.avatarUrl} alt="" width={32} height={32} /> : null}
                  {DEMO_SHOP}
                </p>
                <div className={styles.thread}>
                  <p className={styles.question}>{first.q}</p>
                  <p className={styles.count}>
                    {/* The final count server-side and for reduced motion; the stage ticks it up as the messages arrive. */}
                    <span data-storm-count>{copy.storm.asked(total)}</span>
                  </p>
                  <p className={styles.answer}>{first.a}</p>
                </div>
              </div>
            </Device>
          </div>
        }
      >
        <div className={styles.copy}>
          <h2 id="storm-title" className={`${base.h2} ${styles.title}`}>
            {copy.storm.title}
          </h2>
          <p className={styles.body}>{copy.storm.body}</p>
        </div>
      </StormStage>
    </section>
  );
}
