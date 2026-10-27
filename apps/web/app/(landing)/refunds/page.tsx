import { getSettings } from '@curios/db-read';
import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

// Read like the Terms page: the plan in force, within 30 seconds of a change.
export const revalidate = 30;

export const metadata = legalMetadata('refunds', 'en');

export default async function RefundsPage() {
  return <LegalPage doc="refunds" locale="en" plan={await getSettings()} />;
}
