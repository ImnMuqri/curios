import { getSettings } from '@curios/db-read';
import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

// The prices and free counts the Terms state are the admin's: a change reaches this page within
// 30 seconds, the settings cache's own window. Without a database (a build) the defaults are shown.
export const revalidate = 30;

export const metadata = legalMetadata('terms', 'en');

export default async function TermsPage() {
  return <LegalPage doc="terms" locale="en" plan={await getSettings()} />;
}
