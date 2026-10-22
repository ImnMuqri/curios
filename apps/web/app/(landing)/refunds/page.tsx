import { LegalPage, legalMetadata } from '../../_legal/LegalPage.js';

export const metadata = legalMetadata('refunds', 'en');

export default function RefundsPage() {
  return <LegalPage doc="refunds" locale="en" />;
}
