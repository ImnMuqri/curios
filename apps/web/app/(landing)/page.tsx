import { getSettings } from '@curios/db-read';
import { LandingPage, landingMetadata } from '../_landing/LandingPage.js';

export const metadata = landingMetadata('en');

// The prices and free leads are the admin's: a change reaches this page within 30 seconds, the
// settings cache's own window. Without a database (a build) the defaults are shown.
export const revalidate = 30;

export default async function Home() {
  return <LandingPage locale="en" terms={await getSettings()} />;
}
