import type { Metadata } from 'next';
import { SignIn } from './signin-form.js';

export const metadata: Metadata = { title: 'Sign in · Curios admin' };

export default function SignInPage() {
  return <SignIn />;
}
