import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

export const metadata = legalMetadata('privacy', 'en');

export default function PrivacyPage() {
  return <LegalPage doc="privacy" locale="en" />;
}
