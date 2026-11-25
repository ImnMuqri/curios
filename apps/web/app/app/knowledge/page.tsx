import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  FACT_CATEGORIES,
  NEVER_SAY_MAX,
  NEVER_SAY_MAX_CHARS,
  OWNER_FACT_MAX,
  PASTED_TEXT_MAX,
  SESSION_COOKIE,
} from '@curios/core';
import { getKnowledge, getOwnerPage, getTopics } from '@curios/db-read';

import { resolveOwner } from '../session.js';
import { KnowledgeTabs, parseTab } from './tabs.js';
import { Sources } from './sources-tab.js';
import { Facts } from './facts-tab.js';
import { Pinned } from './pinned-tab.js';
import { NeverSay } from './never-say-tab.js';
import { HeadActions } from './head-actions.js';
import { PageHead } from '../_ui/page-head.js';
import { STARTERS } from '../_ui/starters.js';
import styles from './knowledge.module.css';

/** The tab's name: "Curios - Facts & sources" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'Facts & sources' };

/**
 * Everything the chat answers from, in one place, and the way to remove any
 * of it. The header carries "Try your page" (opens "Ask your page" as a side
 * sheet, to hear what the chat says with it) and "+ Add a fact". The
 * tab is in the address (`?add=1` opens a tab's add form). Constants the
 * client tabs need cross as props: a client component may not import the
 * core barrel.
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const [page, knowledge, asked] = await Promise.all([
    getOwnerPage(owner.accountId),
    getKnowledge(owner.accountId),
    // What customers ask most, to try asking.
    getTopics(owner.accountId, { limit: 4 }),
  ]);
  if (!page || !knowledge) redirect('/app/onboarding');

  const params = await searchParams;
  const tab = parseTab(params.tab);
  const startAdding = params.add === '1';
  const suggestions = asked.length > 0 ? asked.map((topic) => topic.title) : [...STARTERS[page.mode]];

  return (
    <div className={styles.kb}>
      <div className={styles.kmain}>
        <div className={styles.head}>
          <PageHead kicker="Knowledge" title="Facts & sources" summary="Everything your page knows, and where it learned it.">
            <HeadActions tab={tab} pageName={page.displayName} suggestions={suggestions} />
          </PageHead>
        </div>
        <KnowledgeTabs
          current={tab}
          counts={{
            facts: knowledge.facts.length,
            sources: knowledge.sources.length,
            pinned: knowledge.pinned.length,
            'never-say': knowledge.neverSay.length,
          }}
        />
        {tab === 'facts' ? (
          <Facts facts={knowledge.facts} categories={[...FACT_CATEGORIES]} ownerFactMax={OWNER_FACT_MAX} startAdding={startAdding} />
        ) : tab === 'sources' ? (
          <Sources sources={knowledge.sources} pageId={page.id} pastedTextMax={PASTED_TEXT_MAX} startAdding={startAdding} />
        ) : tab === 'pinned' ? (
          <Pinned pinned={knowledge.pinned} />
        ) : (
          <NeverSay entries={knowledge.neverSay} max={NEVER_SAY_MAX} maxChars={NEVER_SAY_MAX_CHARS} />
        )}
      </div>
    </div>
  );
}
