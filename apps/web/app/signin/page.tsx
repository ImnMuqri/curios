import type { Metadata } from 'next';
import { connectToApi } from '../../lib/api-hints.js';
import { SignIn } from './signin-form.js';

export const metadata: Metadata = {
  title: 'Sign in · Curios',
  description: 'Sign in to Curios to manage your page, its answers and your shop.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; next?: string; error?: string }>;
}) {
  connectToApi();
  const params = await searchParams;

  return (
    <SignIn
      cancelled={params.cancelled === '1'}
      next={params.next ?? '/app'}
      error={params.error}
    />
  );
}
