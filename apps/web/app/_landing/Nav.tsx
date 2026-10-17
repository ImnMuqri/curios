import type { LandingCopy } from './copy.js';
import { Wordmark } from './Wordmark.js';
import styles from './tanya.module.css';

/** A pill floating over the top of the page: the sections, the other language, sign in, and the one call to action. */
export function Nav({ copy, home }: { copy: LandingCopy; home: string }) {
  const { nav } = copy;
  return (
    <header className={styles.navwrap}>
      <div className={styles.navpill}>
        <a href={home} className={styles.brand}>
          <Wordmark />
          <span className={styles.srOnly}>Curios</span>
        </a>
        <nav className={styles.navlinks} aria-label={nav.sections}>
          <a href="#who">{nav.who}</a>
          <a href="#how">{nav.how}</a>
          <a href="#business">{nav.business}</a>
          <a href="#pricing">{nav.pricing}</a>
          <a href="#faq">{nav.faq}</a>
        </nav>
        <div className={styles.navright}>
          <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang} className={styles.lang} aria-label={nav.other.name}>
            {nav.other.short}
          </a>
          <a href="/signin">{nav.signIn}</a>
          <a href="/signup" className={styles.navcta}>
            {nav.cta}
          </a>
        </div>
      </div>
    </header>
  );
}
