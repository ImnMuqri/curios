import { LegalPage, legalMetadata } from '../../../_legal/LegalPage.js';

export const metadata = legalMetadata('privacy', 'ms');

export default function PrivacyPageMs() {
  return <LegalPage doc="privacy" locale="ms" />;
}
