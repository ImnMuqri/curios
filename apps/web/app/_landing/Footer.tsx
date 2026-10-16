import type { LandingCopy } from './copy.js';
import { Wordmark } from './Wordmark.js';
import styles from './tanya.module.css';

/** The sections again, sign in, the other language, the note that every sample is made up, and the wordmark at full width. */
export function Footer({ copy }: { copy: LandingCopy }) {
  const { nav } = copy;
  return (
    <footer className={styles.foot}>
      <div className={styles.wrap}>
        <div className={styles.footRow}>
          <nav aria-label={nav.sections} className={styles.footLinks}>
            <a href="#who">{nav.who}</a>
            <a href="#how">{nav.how}</a>
            <a href="#business">{nav.business}</a>
            <a href="#pricing">{nav.pricing}</a>
            <a href="#faq">{nav.faq}</a>
          </nav>
          <div className={`${styles.footLinks} ${styles.footEnd}`}>
            <a href="/signin">{copy.footer.signIn}</a>
            <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang}>
              {nav.other.name}
            </a>
          </div>
        </div>
        <p className={styles.footNote}>{copy.footer.note}</p>
      </div>
      <span className={styles.footMark} aria-hidden="true">
        <Wordmark />
      </span>
    </footer>
  );
}
