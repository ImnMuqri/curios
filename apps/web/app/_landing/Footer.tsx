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
export function Footer({
  copy,
  locale,
  sectionsBase = '',
  note,
  showOperator = true,
}: {
  copy: LandingCopy;
  locale: Locale;
  /** Where the section links point: empty on the landing itself, the landing's path on the legal pages. */
  sectionsBase?: string;
  /** Another line in place of "every sample is made up" (the legal pages name who runs Curios). */
  note?: string;
  /** False where `note` already says who runs Curios. */
  showOperator?: boolean;
}) {
  const { nav } = copy;
  return (
    <footer className={calm.wrap}>
      <div className={styles.foot}>
        <a href={locale === 'ms' ? '/ms' : '/'} className={styles.brand}>
          <Wordmark />
        </a>
        <nav aria-label={nav.sections} className={styles.links}>
          <a href={`${sectionsBase}#who`}>{nav.who}</a>
          <a href={`${sectionsBase}#how`}>{nav.how}</a>
          <a href={`${sectionsBase}#business`}>{nav.business}</a>
          <a href={`${sectionsBase}#pricing`}>{nav.pricing}</a>
          <a href={`${sectionsBase}#faq`}>{nav.faq}</a>
        </nav>
        <div className={styles.links}>
          <a href="/signin">{copy.footer.signIn}</a>
          <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang}>
            {nav.other.name}
          </a>
        </div>
        <p className={styles.note}>{note ?? copy.footer.note}</p>
        {/* Curios's listing on MakaKami, the Malaysian product directory: their badge, as they give it. */}
        <a className={styles.badge} href="https://makakami.com.my/app/curios" target="_blank" rel="noopener">
          <img src="https://makakami.com.my/badge/curios.svg" alt="Listed on MakaKami" width={150} height={40} loading="lazy" />
        </a>
        <div className={styles.legal}>
          <div className={styles.legalLinks}>
            {LEGAL_DOCS.map((doc) => (
              <a key={doc} href={LEGAL_PATH[locale][doc]}>
                {CHROME[locale].tab[doc]}
              </a>
            ))}
          </div>
          {showOperator ? (
            <p className={styles.co}>
              <span>{OPERATOR.name}</span>
              <span>
                {OPERATOR.registration} ({OPERATOR.oldRegistration})
              </span>
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
