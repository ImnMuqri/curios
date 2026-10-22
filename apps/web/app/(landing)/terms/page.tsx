import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

export const metadata = legalMetadata('terms', 'en');

export default function TermsPage() {
  return <LegalPage doc="terms" locale="en" />;
}
