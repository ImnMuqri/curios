import { getSettings } from '@curios/db-read';
import { LegalPage, legalMetadata } from '../../../_legal/LegalPage.js';

// Read like the Terms page: the plan in force, within 30 seconds of a change.
export const revalidate = 30;

export const metadata = legalMetadata('terms', 'ms');

export default async function TermsPageMs() {
  return <LegalPage doc="terms" locale="ms" plan={await getSettings()} />;
}
