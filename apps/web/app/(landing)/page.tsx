import { LandingPage, landingMetadata } from '../_landing/LandingPage.js';

export const metadata = landingMetadata('en');

export default function Home() {
  return <LandingPage locale="en" />;
}
