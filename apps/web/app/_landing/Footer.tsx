import type { LandingCopy, Locale } from './copy.js';
import { CHROME, LEGAL_DOCS, LEGAL_PATH, OPERATOR, SUPPORT_EMAIL } from '../_legal/content.js';
import { FooterPeek } from './FooterPeek.js';
import { Wordmark } from './Wordmark.js';
import styles from './tanya.module.css';

/**
 * The sections again, the Terms, Privacy, Refund and Return pages (not on the board,
 * DEVIATIONS 138), sign in, the other language, the note that every sample is
 * made up, who runs Curios (the business, its SSM number in both formats, and
 * the support address), and the wordmark at full width.
 */
export function Footer({ copy, locale }: { copy: LandingCopy; locale: Locale }) {
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
            {LEGAL_DOCS.map((doc) => (
              <a key={doc} href={LEGAL_PATH[locale][doc]}>
                {CHROME[locale].tab[doc]}
              </a>
            ))}
            <a href="/signin">{copy.footer.signIn}</a>
            <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang}>
              {nav.other.name}
            </a>
          </div>
        </div>
        <p className={styles.footNote}>{copy.footer.note}</p>
        <p className={styles.footCo}>
          <span>{OPERATOR.name}</span>
          <span>
            {OPERATOR.registration} ({OPERATOR.oldRegistration})
          </span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </div>
      <span className={styles.footMark} aria-hidden="true">
        <Wordmark className={styles.footWord} tone="ghost">
          <FooterPeek />
        </Wordmark>
      </span>
    </footer>
  );
}
