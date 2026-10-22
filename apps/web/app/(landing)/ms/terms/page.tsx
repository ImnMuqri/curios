import { LegalPage, legalMetadata } from '../../../_legal/LegalPage.js';

export const metadata = legalMetadata('terms', 'ms');

export default function TermsPageMs() {
  return <LegalPage doc="terms" locale="ms" />;
}
