'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ask } from './ask-panel.js';
import { ADD_FACT_EVENT } from './facts-tab.js';
import type { KnowledgeTab } from './tabs.js';
import styles from './knowledge.module.css';

/**
 * The header's two buttons (the Dash board's `.hrow .acts`): "Try your page" opens "Ask your page" as
 * the dashboard's side sheet, and "+ Add a fact" opens the Facts tab's add line, or goes to the Facts
 * tab with it open from any other tab.
 */
export function HeadActions({ tab, pageName, suggestions }: { tab: KnowledgeTab; pageName?: string; suggestions: string[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={opener} type="button" className={`${styles.btn2} ${styles.headBtn}`} aria-haspopup="dialog" onClick={() => setAsking(true)}>
        Try your page
      </button>
      <button
        type="button"
        className={`${styles.prim} ${styles.headBtn}`}
        onClick={() => {
          if (tab === 'facts') window.dispatchEvent(new Event(ADD_FACT_EVENT));
          else router.push('/app/knowledge?tab=facts&add=1');
        }}
      >
        + Add a fact
      </button>
      <Ask open={asking} onClose={() => setAsking(false)} returnFocusTo={opener} pageName={pageName} suggestions={suggestions} />
    </>
  );
}
