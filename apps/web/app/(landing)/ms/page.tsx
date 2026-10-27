import { getSettings } from '@curios/db-read';
import { LandingPage, landingMetadata } from '../../_landing/LandingPage.js';

export const metadata = landingMetadata('ms');

// As the English page: the admin's prices, within 30 seconds of a change.
export const revalidate = 30;

export default async function HomeMs() {
  return <LandingPage locale="ms" terms={await getSettings()} />;
}
