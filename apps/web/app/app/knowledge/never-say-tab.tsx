'use client';

import type { KnowledgeNeverSay } from '@curios/db-read';

export function NeverSay(_props: { entries: KnowledgeNeverSay[]; max: number; maxChars: number }) {
  return <h2>Never say</h2>;
}
