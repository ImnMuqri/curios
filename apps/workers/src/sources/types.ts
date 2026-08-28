import type { SourceDocument } from '@curios/core';

export interface SourceAdapter {
  id: 'website' | 'instagram';
  fetch(input: string): Promise<SourceDocument[]>;
}
