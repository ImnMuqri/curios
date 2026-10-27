import { getSettings } from '@curios/db-read';
import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

// Read like the Terms page: the plan in force, within 30 seconds of a change.
export const revalidate = 30;

export const metadata = legalMetadata('privacy', 'en');

export default async function PrivacyPage() {
  return <LegalPage doc="privacy" locale="en" plan={await getSettings()} />;
}
