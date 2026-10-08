import type { CSSProperties } from 'react';
import type { LandingCopy } from './copy.js';
import { ClaimField } from './ClaimField.js';
import { HeroDemo } from './HeroDemo.js';
import { PhotoSlot } from './PhotoSlot.js';
import base from './landing.module.css';
import styles from './hero.module.css';

/**
 * The promise, the mechanism, and the curios.my/ field to claim a page on the
 * spot. On the right, a photograph of an owner (to come) with the real product
 * in front of it: a Curios page component, rendered with the demo shop's
 * data, whose ask bar answers when tapped.
 */
export function Hero({ copy }: { copy: LandingCopy }) {
  return (
    <section className={`${base.bandMuda} ${styles.hero}`} aria-labelledby="hero-title">
      <div className={`${base.wrap} ${styles.grid}`}>
        <div className={styles.text}>
          {/* Each word its own span, so the headline can rise in a word at a time on load. The text reads the same. */}
          <h1 id="hero-title" className={styles.title}>
            {copy.hero.title.split(' ').map((word, i, all) => (
              <span key={i}>
                <span className={styles.word} style={{ '--i': i } as CSSProperties}>
                  {word}
                </span>
                {i < all.length - 1 ? ' ' : null}
              </span>
            ))}
          </h1>
          <p className={`${styles.sub} ${styles.after}`}>{copy.hero.sub}</p>
          <div className={`${styles.actions} ${styles.after}`}>
            <ClaimField id="claim-hero" label={copy.claim.label} placeholder={copy.claim.placeholder} button={copy.hero.cta} />
            <p className={styles.note}>{copy.hero.ctaNote}</p>
          </div>
        </div>
        <figure className={styles.proof}>
          <PhotoSlot
            shot={copy.photos.hero}
            src="/landing/hero-baker.webp"
            alt="A home baker at her kitchen counter, smiling at her phone beside a chocolate cake and cake boxes"
            // Her face, phone and the cake sit upper right; the demo phone covers the lower left.
            focus="62% 22%"
            priority
            className={styles.photo}
          />
          <div className={styles.phoneWrap}>
            <HeroDemo label={copy.demo.label} hint={copy.hero.tryHint} shop={copy.shop} />
          </div>
          <figcaption className={styles.caption}>{copy.hero.demoNote}</figcaption>
        </figure>
      </div>
    </section>
  );
}
