import type { SourceDocument } from '@curios/core';
import type { SourceAdapter } from './types.js';

/**
 * Deliberately unimplemented. The interface ships so the pipeline shape is
 * proven before the platform access question is answered; swapping in real
 * access must not require touching anything downstream of here.
 */
export const instagramAdapter: SourceAdapter = {
  id: 'instagram',
  async fetch(_input: string): Promise<SourceDocument[]> {
    throw new Error(
      'NOT_CONFIGURED: Instagram ingestion is not available yet. Paste your website address instead.',
    );
  },
};
