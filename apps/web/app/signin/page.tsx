import { SignIn } from './signin-form.js';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; next?: string }>;
}) {
  const params = await searchParams;

  return <SignIn cancelled={params.cancelled === '1'} next={params.next ?? '/app'} />;
}
