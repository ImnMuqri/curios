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
import { getKnowledge, getOwnerPage } from '@curios/db-read';

import { resolveOwner } from '../session.js';
import { KnowledgeTabs, parseTab } from './tabs.js';
import { Sources } from './sources-tab.js';
import { Facts } from './facts-tab.js';
import { Pinned } from './pinned-tab.js';
import { NeverSay } from './never-say-tab.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

/**
 * Everything the chat answers from, in one place, and the way to remove any
 * of it. The tab is in the address. Constants the client tabs need cross as
 * props: a client component may not import the core barrel.
 */
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const [page, knowledge] = await Promise.all([getOwnerPage(owner.accountId), getKnowledge(owner.accountId)]);
  if (!page || !knowledge) redirect('/app/onboarding');

  const tab = parseTab((await searchParams).tab);

  return (
    <>
      <PageHead title="Facts & sources" note="Everything your page knows, and where it learned it" />
      <div className={panel.body}>
        <KnowledgeTabs current={tab} />
        {tab === 'facts' ? (
          <Facts facts={knowledge.facts} categories={[...FACT_CATEGORIES]} ownerFactMax={OWNER_FACT_MAX} />
        ) : tab === 'sources' ? (
          <Sources sources={knowledge.sources} pageId={page.id} mode={page.mode} pastedTextMax={PASTED_TEXT_MAX} />
        ) : tab === 'pinned' ? (
          <Pinned pinned={knowledge.pinned} />
        ) : (
          <NeverSay entries={knowledge.neverSay} max={NEVER_SAY_MAX} maxChars={NEVER_SAY_MAX_CHARS} />
        )}
      </div>
    </>
  );
}
