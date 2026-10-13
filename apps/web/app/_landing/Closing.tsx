import type { LandingCopy } from './copy.js';
import { ClaimField } from './ClaimField.js';
import { Reveal } from './Reveal.js';
import { Wordmark } from './Wordmark.js';
import base from './landing.module.css';
import styles from './closing.module.css';

/**
 * The last ask, on the ink band: the curios.my/ field again, so the
 * page ends where it started. The footer is a white card on the same band.
 */
export function Closing({ copy, otherHome }: { copy: LandingCopy; otherHome: string }) {
  return (
    <div className={`${base.bandInk} ${styles.closing}`}>
      <section className={styles.final} aria-labelledby="final-title">
        <div className={base.wrap}>
          <Reveal>
            <h2 id="final-title" className={`${base.h2} ${styles.title}`}>
              {copy.final.title}
            </h2>
            <p className={styles.sub}>{copy.final.sub}</p>
          </Reveal>
          <ClaimField id="claim-final" label={copy.claim.label} placeholder={copy.claim.placeholder} button={copy.final.cta} />
        </div>
      </section>
      <footer className={base.wrap}>
        <div className={styles.footer}>
          <Wordmark className={styles.mark} />
          <nav className={styles.links} aria-label={copy.locale === 'ms' ? 'Kaki' : 'Footer'}>
            <a href="/signup">{copy.footer.start}</a>
            <a href="/signin">{copy.footer.signIn}</a>
            <a href={otherHome} hrefLang={copy.locale === 'ms' ? 'en' : 'ms'} lang={copy.locale === 'ms' ? 'en' : 'ms'}>
              {copy.locale === 'ms' ? 'English' : 'Bahasa Melayu'}
            </a>
          </nav>
          <p className={styles.note}>{copy.footer.demoNote}</p>
        </div>
      </footer>
    </div>
  );
}
