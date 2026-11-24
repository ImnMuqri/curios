'use client';

import { useEffect, useState } from 'react';
import type { LandingCopy } from './copy.js';
import { Wordmark } from './Wordmark.js';
import calm from './calm.module.css';
import styles from './nav.module.css';

/**
 * The calm nav (Landing2 board): sticky, clear over the hero, frosted once the
 * page has scrolled. The sections, the other language, sign in, and the one
 * call to action.
 */
export function Nav({
  nav,
  home,
  sectionsBase = '',
  action,
}: {
  nav: LandingCopy['nav'];
  home: string;
  /** Where the section links point: empty on the landing itself, the landing's path on the other Site pages. */
  sectionsBase?: string;
  /** One quiet button in place of Sign in and the call to action (the report pages' "Back to {name}"). */
  action?: { label: string; href: string };
}) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={styles.nav} data-stuck={stuck ? '' : undefined}>
      <div className={styles.inner}>
        <a href={home} className={styles.brand}>
          <Wordmark />
          <span className={calm.srOnly}>Curios</span>
        </a>
        <nav className={styles.links} aria-label={nav.sections}>
          <a href={`${sectionsBase}#who`}>{nav.who}</a>
          <a href={`${sectionsBase}#how`}>{nav.how}</a>
          <a href={`${sectionsBase}#business`}>{nav.business}</a>
          <a href={`${sectionsBase}#pricing`}>{nav.pricing}</a>
          <a href={`${sectionsBase}#faq`}>{nav.faq}</a>
        </nav>
        <div className={styles.right}>
          <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang} className={styles.quiet} aria-label={nav.other.name}>
            {nav.other.short}
          </a>
          {action ? (
            <a href={action.href} className={`${calm.btn} ${calm.lite} ${calm.sm} ${styles.cta}`}>
              {action.label}
            </a>
          ) : (
            <>
              <a href="/signin" className={styles.quiet}>
                {nav.signIn}
              </a>
              <a href="/signup" className={`${calm.btn} ${calm.dark} ${calm.sm} ${styles.cta}`}>
                {nav.cta}
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
