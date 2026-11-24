import type { Metadata } from 'next';
import { getPageAvailability } from '@curios/db-read';
import { SystemActions, SystemCard, SystemShell, systemStyles as styles } from './SystemShell.js';
import { LockedArt } from './art.js';
import { unavailableCopy } from './unavailable-copy.js';

/** Not for search results, and not followed: a suspended page leaves the index. */
export const UNAVAILABLE_METADATA: Metadata = { title: 'Unavailable · Curios', robots: { index: false, follow: false } };

/**
 * What a visitor sees at any address of a suspended page, in the page's own
 * language: the Site board's shell, one line, a way out. The reason is the
 * owner's to read, never the visitor's. "Go to Curios" is the way out.
 */
export function UnavailableScreen({ language }: { language: string }) {
  const copy = unavailableCopy(language);
  return (
    <SystemShell locale={language === 'ms' ? 'ms' : 'en'}>
      <SystemCard art={<LockedArt />} title={copy.title} lede={copy.lede}>
        <SystemActions>
          <a className={styles.ghost} href="/">
            {copy.home}
          </a>
        </SystemActions>
      </SystemCard>
    </SystemShell>
  );
}

/**
 * The page's language when it is suspended, else null. Routes ask this where
 * their own read came back empty, before they answer 404.
 */
export async function suspendedLanguage(handle: string): Promise<string | null> {
  const { status, language } = await getPageAvailability(handle);
  return status === 'suspended' ? language : null;
}
