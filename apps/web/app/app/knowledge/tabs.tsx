import Link from 'next/link';
import pills from '../_ui/pill-tabs.module.css';
import styles from './knowledge.module.css';

export const KNOWLEDGE_TABS = ['facts', 'sources', 'pinned', 'never-say'] as const;
export type KnowledgeTab = (typeof KNOWLEDGE_TABS)[number];

const LABELS: Record<KnowledgeTab, string> = {
  facts: 'Facts',
  sources: 'Sources',
  pinned: 'Pinned answers',
  'never-say': 'Never say',
};

/** The tab from `?tab=`. Anything unknown is Facts, the tab an owner opens most. */
export function parseTab(raw: string | string[] | undefined): KnowledgeTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (KNOWLEDGE_TABS as readonly string[]).includes(value ?? '') ? (value as KnowledgeTab) : 'facts';
}

/**
 * Links, not buttons: the tab lives in the address, so it can be shared,
 * reloaded, and reached with Back. Next's Link keeps the screen mounted
 * between tabs, so "Ask your page" keeps its conversation. Each tab carries
 * how many things it holds. Drawn in the dashboard's one tab style, the grey
 * track with the chosen tab as a white pill (pill-tabs.module.css), which
 * reads the chosen one from `aria-current`.
 */
export function KnowledgeTabs({ current, counts }: { current: KnowledgeTab; counts?: Partial<Record<KnowledgeTab, number>> }) {
  return (
    <nav aria-label="Knowledge" className={`${pills.track} ${styles.tabs}`}>
      {KNOWLEDGE_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/app/knowledge?tab=${tab}`}
          className={`${pills.pill} ${styles.tab}`}
          aria-current={tab === current ? 'page' : undefined}
          scroll={false}
        >
          {LABELS[tab]}
          {counts?.[tab] !== undefined ? (
            <span className={`${pills.count} ${styles.tabCount}`}>
              <span className={styles.sr}>, </span>
              {counts[tab]}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
