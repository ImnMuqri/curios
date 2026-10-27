import { getSettings } from '@curios/db-read';
import { LegalPage, legalMetadata } from '../../../_legal/LegalPage.js';

// Read like the Terms page: the plan in force, within 30 seconds of a change.
export const revalidate = 30;

export const metadata = legalMetadata('privacy', 'ms');

export default async function PrivacyPageMs() {
  return <LegalPage doc="privacy" locale="ms" plan={await getSettings()} />;
}
