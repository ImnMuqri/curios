import type { Metadata } from 'next';
import { getPageAvailability } from '@curios/db-read';
import { SystemCard, SystemShell } from './SystemShell.js';
import { PadlockArt } from './art.js';
import { unavailableCopy } from './unavailable-copy.js';

/** Not for search results, and not followed: a suspended page leaves the index. */
export const UNAVAILABLE_METADATA: Metadata = { title: 'Unavailable · Curios', robots: { index: false, follow: false } };

/**
 * What a visitor sees at any address of a suspended page, in the page's own
 * language: the System board's shell, one line, a way out. The reason is the
 * owner's to read, never the visitor's.
 */
export function UnavailableScreen({ language }: { language: string }) {
  const copy = unavailableCopy(language);
  return (
    <SystemShell>
      <SystemCard art={<PadlockArt />} title={copy.title} lede={copy.lede} />
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
