'use client';

import type { KnowledgePinned } from '@curios/db-read';

export function Pinned(_props: { pinned: KnowledgePinned[] }) {
  return <h2>Pinned answers</h2>;
}
