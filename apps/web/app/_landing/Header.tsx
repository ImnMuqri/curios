import type { LandingCopy } from "./copy.js";
import { SectionLinks } from "./SectionLinks.js";
import { Wordmark } from "./Wordmark.js";
import base from "./landing.module.css";
import styles from "./header.module.css";

/**
 * A solid full-width bar on paper, sticky as the page scrolls. Section
 * links on wide screens; on a phone only the language, sign-in and the button.
 */
export function Header({
  copy,
  home,
  otherHome,
}: {
  copy: LandingCopy;
  home: string;
  otherHome: string;
}) {
  return (
    <header className={styles.header}>
      <div className={`${base.wrap} ${styles.bar}`} data-pill>
        <a href={home} className={styles.brand}>
          <Wordmark />
          <span className={base.srOnly}>{copy.nav.home}</span>
        </a>
        <SectionLinks
          sections={copy.nav.sections}
          label={copy.locale === "ms" ? "Bahagian" : "Sections"}
        />
        <nav
          className={styles.nav}
          aria-label={copy.locale === "ms" ? "Akaun" : "Account"}
        >
          <a
            href={otherHome}
            className={styles.link}
            hrefLang={copy.locale === "ms" ? "en" : "ms"}
            lang={copy.locale === "ms" ? "en" : "ms"}
          >
            {/* Visible short form first, so the spoken name contains what is shown (WCAG 2.5.3). */}
            {copy.nav.otherLocaleName}
            <span className={base.srOnly}> {copy.nav.otherLocaleLabel}</span>
          </a>
          <a href="/signin" className={`${styles.link} ${styles.signIn}`}>
            {copy.nav.signIn}
          </a>
          <a href="/signup" className={`${base.button} ${styles.cta}`}>
            <span className={styles.ctaLong}>{copy.nav.cta}</span>
            <span className={styles.ctaShort}>{copy.nav.ctaShort}</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
