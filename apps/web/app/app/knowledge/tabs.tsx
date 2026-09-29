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
 * Plain links, not buttons: the tab lives in the address, so it can be shared,
 * reloaded, and reached with Back. Rendered on the server.
 */
export function KnowledgeTabs({ current }: { current: KnowledgeTab }) {
  return (
    <nav aria-label="Knowledge" className={styles.tabs}>
      {KNOWLEDGE_TABS.map((tab) => (
        <a
          key={tab}
          href={`/app/knowledge?tab=${tab}`}
          className={styles.tab}
          aria-current={tab === current ? 'page' : undefined}
        >
          {LABELS[tab]}
        </a>
      ))}
    </nav>
  );
}
