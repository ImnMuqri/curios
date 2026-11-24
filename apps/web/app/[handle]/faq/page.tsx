import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFaqIndex } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../../_system/unavailable.js';
import { PageTheme } from '../../_bento/BentoPage.js';
import { TopBar } from '../top-bar.js';
import sheet from '../sheet.module.css';
import { AskBar } from './ask-bar.js';
import { faqCopy } from './faq-copy.js';
import { FaqList } from './faq-list.js';
import styles from './faq.module.css';

// Node, not edge: this reads Postgres through the read-only role, like
// /[handle].
export const runtime = 'nodejs';

// ISR, per FRONTEND.md's route table. generateStaticParams below lists nothing:
// enumerating every qualifying question at build time would make `pnpm build`
// require a live database, which it does not today.
// 60 seconds, not the 24 hours FRONTEND.md's route table first specified. These
// pages carry a customer's own words, and an owner who takes one down must not
// wait a day to see it gone -- that latency was half of the takedown gap
// recorded in devDocs/deferred-findings.md. Both routes are two indexed reads,
// so the cost of re-rendering more often is small and bounded; the alternative,
// calling revalidatePath from the API, needs a shared secret and couples two
// deployables, which is what choosing ISR was meant to avoid.
export const revalidate = 60;

/**
 * None at build time, so `pnpm build` still needs no database. Its presence is what makes the
 * route ISR: without it Next 15 renders a dynamic segment on every request and `revalidate` above
 * does nothing (measured 2026-10-26 on a production build: every view read Postgres). With it, the
 * first visitor to an address renders it and the next 60 seconds of visitors get that HTML.
 */
export function generateStaticParams(): { handle: string }[] {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const index = await getFaqIndex(handle);
  if (!index) return (await suspendedLanguage(handle)) ? UNAVAILABLE_METADATA : {};
  return {
    title: faqCopy(index.language).indexTitle(index.displayName),
    description: faqCopy(index.language).indexLede(index.displayName),
  };
}

export default async function FaqIndexPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const index = await getFaqIndex(handle);

  if (!index) {
    const suspended = await suspendedLanguage(handle);
    if (suspended) return <UnavailableScreen language={suspended} />;
  }

  // An index with no entries is a page with no reason to exist. 404 rather
  // than publish an empty one -- a thin page indexed is worse than no page.
  if (!index || index.entries.length === 0) notFound();

  // No FAQPage JSON-LD here, deliberately. Google's FAQPage requirements make
  // acceptedAnswer.text mandatory, and this page shows questions only -- the
  // answer text lives on the entry page it links to. Structured data must
  // describe content visible on the page it sits on; inlining every answer
  // here just to satisfy the schema would trade invalid markup for deceptive
  // markup. The entry pages, where the answer is actually visible, carry
  // FAQPage -- and a specific question is what should rank there anyway.
  const copy = faqCopy(index.language);
  return (
    <PageTheme theme={index.theme} className={styles.stage} paintDocument>
      <main className={styles.page}>
        <TopBar title={index.displayName} back={{ href: `/${index.handle}`, label: copy.backTo(index.displayName) }} />
        <div className={`${sheet.sheet} ${styles.sheet}`}>
          <p className={styles.kicker}>{copy.kicker(index.displayName)}</p>
          <h1 className={styles.heading}>{copy.indexTitle(index.displayName)}</h1>
          <p className={styles.lede}>{copy.indexLede(index.displayName)}</p>
          <FaqList handle={index.handle} displayName={index.displayName} entries={index.entries} language={index.language} />
          <a className={styles.back} href={`/${index.handle}`}>
            ‹ {copy.backTo(index.displayName)}
          </a>
          <AskBar handle={index.handle} placeholder={copy.askPlaceholder(index.displayName)} send={copy.askSend} />
        </div>
      </main>
    </PageTheme>
  );
}
