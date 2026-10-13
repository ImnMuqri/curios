import type { CSSProperties } from 'react';
import { BentoPage } from '../_bento/BentoPage.js';
import { shopCopy } from '../[handle]/shop/copy.js';
import type { LandingCopy } from './copy.js';
import { ClaimField } from './ClaimField.js';
import { Device } from './Device.js';
import { HeroStage } from './HeroStage.js';
import { PhotoSlot } from './PhotoSlot.js';
import base from './landing.module.css';
import styles from './hero.module.css';

/** Where the twelve bubbles sit round the phone, as % of the stage from its centre. */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-34, -36], [33, -40], [-40, -14], [38, -18], [-31, 6], [40, 4],
  [-42, 26], [32, 24], [-30, 42], [38, 42], [-24, -46], [26, -6],
];

/**
 * The hero, pinned: Kek Lina's page beside three captions -- the promise,
 * "forty people, one question", "answer it once". Server-rendered in its
 * finished state; HeroStage scrubs it when motion is allowed.
 */
export function HeroScene({ copy }: { copy: LandingCopy }) {
  const { page, qa, storm } = copy.shop;
  const total = storm.length;
  const tile = shopCopy(copy.locale);
  const first = qa[0]!;
  return (
    <section className={`${base.bandMuda} ${styles.hero}`} id="hero" aria-labelledby="hero-title">
      <HeroStage askedLabels={Array.from({ length: total + 1 }, (_, n) => copy.storm.asked(n))} total={total}>
        <div className={`${base.wrap} ${styles.grid}`}>
          <div className={styles.captions}>
            <div className={styles.caption} data-caption="0">
              <h1 id="hero-title" className={styles.title}>
                <span className={styles.line} data-hero-line>{copy.hero.title}</span>
              </h1>
              <p className={styles.sub} data-hero-fade>{copy.hero.sub}</p>
              <div data-hero-fade>
                <ClaimField id="claim-hero" label={copy.claim.label} placeholder={copy.claim.placeholder} button={copy.hero.cta} />
                <p className={styles.note}>{copy.hero.ctaNote}</p>
              </div>
            </div>
            <p className={`${styles.caption} ${styles.big}`} data-caption="1">{copy.heroScene.problem}</p>
            <p className={`${styles.caption} ${styles.big}`} data-caption="2">{copy.heroScene.fix}</p>
          </div>
          <figure className={styles.proof}>
            <PhotoSlot shot={copy.photos.hero} src="/landing/hero-baker.webp" alt="" focus="62% 22%" priority className={styles.photo} />
            <ul className={styles.bubbles} aria-hidden="true">
              {storm.slice(0, SPOTS.length).map((wording, i) => (
                <li key={i} className={styles.bubble} data-bubble style={{ '--i': i, '--x': `${SPOTS[i]![0]}%`, '--y': `${SPOTS[i]![1]}%` } as CSSProperties}>
                  {wording}
                </li>
              ))}
            </ul>
            <div className={styles.phone}>
              <Device time="3:15" chrome="browser" url={`curios.my/${page.handle}`}>
                <div className={styles.screen}>
                  <div className={styles.idle} aria-hidden="true">
                    <BentoPage {...page} nameAs="p" interactive={false} shop={{ position: 0, size: null, label: tile.visit, caption: tile.itemCount(copy.shop.items.length), photoUrl: null }} />
                  </div>
                  <div className={styles.chat}>
                    <BentoPage {...page} nameAs="p" interactive={false} mode="chat">
                      <div className={styles.thread}>
                        <p className={styles.question}>{first.q}</p>
                        <p className={styles.count}>
                          <span data-hero-count>{copy.storm.asked(total)}</span>
                        </p>
                        <p className={styles.answer}>{first.a}</p>
                      </div>
                    </BentoPage>
                  </div>
                </div>
              </Device>
            </div>
            <figcaption className={styles.demoNote}>{copy.hero.demoNote}</figcaption>
          </figure>
          {/* Inside the sticky grid, so it stays at the foot of the pinned view. */}
          <p className={styles.cue} aria-hidden="true">{copy.heroScene.scrollCue}</p>
        </div>
      </HeroStage>
    </section>
  );
}
