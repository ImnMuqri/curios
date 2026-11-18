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
export function Nav({ nav, home }: { nav: LandingCopy['nav']; home: string }) {
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
          <a href="#who">{nav.who}</a>
          <a href="#how">{nav.how}</a>
          <a href="#business">{nav.business}</a>
          <a href="#pricing">{nav.pricing}</a>
          <a href="#faq">{nav.faq}</a>
        </nav>
        <div className={styles.right}>
          <a href={nav.other.href} hrefLang={nav.other.lang} lang={nav.other.lang} className={styles.quiet} aria-label={nav.other.name}>
            {nav.other.short}
          </a>
          <a href="/signin" className={styles.quiet}>
            {nav.signIn}
          </a>
          <a href="/signup" className={`${calm.btn} ${calm.dark} ${calm.sm}`}>
            {nav.cta}
          </a>
        </div>
      </div>
    </header>
  );
}
