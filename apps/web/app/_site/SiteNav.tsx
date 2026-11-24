import { COPY, type Locale } from '../_landing/copy.js';
import { Nav } from '../_landing/Nav.js';

/**
 * The landing's own nav on the pages that are not the landing (sign in, the
 * system screens, the legal pages): same sections, same language link, same
 * sign in and call to action, the section links pointing back at the landing.
 * `action` swaps the last two for one quiet button ("Back to Kek Lina" on the
 * report pages).
 */
export function SiteNav({ locale = 'en', action }: { locale?: Locale; action?: { label: string; href: string } }) {
  const home = locale === 'ms' ? '/ms' : '/';
  return <Nav nav={COPY[locale].nav} home={home} sectionsBase={locale === 'ms' ? '/ms' : '/'} action={action} />;
}
