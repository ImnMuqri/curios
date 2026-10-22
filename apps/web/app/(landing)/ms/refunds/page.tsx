import { LegalPage, legalMetadata } from '../../../_legal/LegalPage.js';

export const metadata = legalMetadata('refunds', 'ms');

export default function RefundsPageMs() {
  return <LegalPage doc="refunds" locale="ms" />;
}
