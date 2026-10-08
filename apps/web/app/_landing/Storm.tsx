import type { LandingCopy } from './copy.js';
import { DEMO_QA, STORM_REPLY, STORM_WORDINGS } from './demo.js';
import { PhotoSlot } from './PhotoSlot.js';
import { StormStage } from './StormStage.js';
import base from './landing.module.css';
import styles from './storm.module.css';

/**
 * The page's one orchestrated moment. Forty ways of asking the same thing
 * slide past in ticker rows. Beside the heading, a photograph of an owner
 * (to come) carries the product floating over it: as the visitor scrolls,
 * the one question arrives -- "asked 40×", the way the Questions screen
 * counts it -- then the owner's answer, and then every wording in the moving
 * rows gets that answer attached, one by one.
 *
 * Server-rendered text; the client stage only moves things.
 */
export function Storm({ copy }: { copy: LandingCopy }) {
  const first = DEMO_QA[0]!;

  return (
    <section className={`${base.bandInk} ${styles.storm}`} id="storm" aria-labelledby="storm-title">
      <StormStage wordings={STORM_WORDINGS} reply={STORM_REPLY}>
        <div className={styles.copy}>
          <h2 id="storm-title" className={`${base.h2} ${styles.title}`}>
            {copy.storm.title}
          </h2>
          <p className={styles.body}>{copy.storm.body}</p>
        </div>
        <figure className={styles.visual}>
          <PhotoSlot shot={copy.photos.storm} className={styles.photo} />
          <p className={styles.question}>
            <span className={styles.questionPill}>{first.q}</span>
            <span className={styles.count}>{copy.storm.asked(STORM_WORDINGS.length)}</span>
          </p>
          <p className={styles.answer}>{first.a}</p>
        </figure>
      </StormStage>
    </section>
  );
}
