import type { Metadata } from 'next';
import { connectToApi } from '../../lib/api-hints.js';
import { Forgot } from './forgot-form.js';

export const metadata: Metadata = {
  title: 'Forgot your password · Curios',
  description: 'Get a link to choose a new password for your Curios account.',
};

export default function ForgotPage() {
  connectToApi();
  return <Forgot />;
}
