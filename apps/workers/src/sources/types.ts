import type { SourceDocument } from '@curios/core';

export interface SourceAdapter {
  id: 'website' | 'instagram' | 'text';
  fetch(input: string): Promise<SourceDocument[]>;
}
