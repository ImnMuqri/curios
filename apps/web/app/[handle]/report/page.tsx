import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicPage } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../../_system/unavailable.js';
import { Report } from './report-form.js';

// Node, not edge: this reads Postgres through the read-only role, like /[handle].
export const runtime = 'nodejs';

// Never indexed: a form is not something to search for, on any page.
const NOINDEX = { robots: { index: false, follow: false } } satisfies Metadata;

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) return (await suspendedLanguage(handle)) ? UNAVAILABLE_METADATA : NOINDEX;
  return { ...NOINDEX, title: `Report ${page.displayName}` };
}

export default async function ReportPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const page = await getPublicPage(handle);
  if (!page) {
    // The same answer /[handle] gives: the unavailable screen for a suspended page, else 404.
    const suspended = await suspendedLanguage(handle);
    if (suspended) return <UnavailableScreen language={suspended} />;
    notFound();
  }
  return <Report handle={page.handle} displayName={page.displayName} language={page.language} />;
}
