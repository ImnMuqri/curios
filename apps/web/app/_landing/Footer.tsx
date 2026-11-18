import type { LandingCopy, Locale } from './copy.js';
import { CHROME, LEGAL_DOCS, LEGAL_PATH, OPERATOR, SUPPORT_EMAIL } from '../_legal/content.js';
import { Wordmark } from './Wordmark.js';
import calm from './calm.module.css';
import styles from './footer.module.css';

/**
 * The calm footer (Landing2 board): the wordmark, the sections, sign in and
 * the other language by name, then the note that every sample is made up.
 * Kept from before, though not on the board: the Terms, Privacy, Refund and
 * Return pages (DEVIATIONS 138) and who runs Curios (its SSM number in both
 * formats, and the support address).
 */
export function Footer({ copy, locale }: { copy: LandingCopy; locale: Locale }) {
  const { nav } = copy;
  return (
    <footer className={calm.wrap}>
      <div className={styles.foot}>
        <a href={locale === 'ms' ? '/ms' : '/'} className={styles.brand}>
          <Wordmark />
        </a>
        <nav aria-label={nav.sections} className={styles.links}>
          <a href="#who">{nav.who}</a>
          <a href="#how">{nav.how}</a>
          <a href="#business">{nav.business}</a>
          <a href="#pricing">{nav.pricing}</a>
          <a href="#faq">{nav.faq}</a>
        </nav>
        <div className={styles.links}>
          <a href="/signin">{copy.footer.signIn}</a>
          <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang}>
            {nav.other.name}
          </a>
        </div>
        <p className={styles.note}>{copy.footer.note}</p>
        <div className={styles.legal}>
          <div className={styles.legalLinks}>
            {LEGAL_DOCS.map((doc) => (
              <a key={doc} href={LEGAL_PATH[locale][doc]}>
                {CHROME[locale].tab[doc]}
              </a>
            ))}
          </div>
          <p className={styles.co}>
            <span>{OPERATOR.name}</span>
            <span>
              {OPERATOR.registration} ({OPERATOR.oldRegistration})
            </span>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </div>
    </footer>
  );
}
