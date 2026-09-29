'use client';

import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';

export function Facts(_props: { facts: KnowledgeFact[]; categories: FactCategory[]; ownerFactMax: number }) {
  return <h2>Facts</h2>;
}
