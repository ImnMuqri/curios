import { BentoPage } from '../_bento/BentoPage.js';
import type { LandingCopy } from './copy.js';
import { DEMO_PAGE, DEMO_QA, STORM_WORDINGS } from './demo.js';
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
          <div className={styles.phone}>
            <Device time="3:15" chrome="browser" url={`curios.my/${DEMO_PAGE.handle}`}>
              <div className={styles.screen}>
                {/* Kek Lina's real page -- the one the hero shows -- already in chat mode. */}
                <BentoPage {...DEMO_PAGE} mode="chat">
                <div className={styles.thread}>
                  <p className={styles.question}>{first.q}</p>
                  <p className={styles.count}>
                    {/* The final count server-side and for reduced motion; the stage ticks it up as the messages arrive. */}
                    <span data-storm-count>{copy.storm.asked(total)}</span>
                  </p>
                  <p className={styles.answer}>{first.a}</p>
                </div>
                </BentoPage>
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
