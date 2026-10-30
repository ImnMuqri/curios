import { getSettings } from '@curios/db-read';
import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

// Read like the Terms page: the plan in force, within 30 seconds of a change.
export const revalidate = 30;

export const metadata = legalMetadata('returns', 'en');

export default async function ReturnsPage() {
  return <LegalPage doc="returns" locale="en" plan={await getSettings()} />;
}
