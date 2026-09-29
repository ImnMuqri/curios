'use client';

import type { KnowledgeSource } from '@curios/db-read';

export function Sources(_props: {
  sources: KnowledgeSource[];
  pageId: string;
  mode: 'PERSONAL' | 'BUSINESS';
  pastedTextMax: number;
}) {
  return <h2>Sources</h2>;
}
