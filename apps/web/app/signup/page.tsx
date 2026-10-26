import type { Metadata } from 'next';
import { connectToApi } from '../../lib/api-hints.js';
import { SignUp } from './signup-form.js';

export const metadata: Metadata = {
  title: 'Create your free page · Curios',
  description: 'Claim your curios.my address and make a link in bio people can ask. Free for anyone.',
};

export default function SignUpPage() {
  connectToApi();
  return <SignUp />;
}
