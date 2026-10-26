import { Callout } from '@curios/ui';
import { getSettings } from '@curios/db-read';
import { AuthShell } from '../_auth/AuthShell.js';
import { SignUp } from './signup-form.js';

// Read per request: the admin closing sign-ups must show here within the settings' 30 seconds.
export const dynamic = 'force-dynamic';

/**
 * Sign up, or -- while the admin has sign-ups closed -- the line that says Curios is full, in
 * place of Google and the form. `closed=1` is where the API's Google callback sends a new
 * person while sign-ups are closed, so it says the same even inside the cache's window.
 * English only, as the rest of this screen is.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const params = await searchParams;
  const { switches } = await getSettings();

  if (!switches.signups || params.closed === '1') {
    return (
      <AuthShell
        title="Create your free page"
        switchTo={{ prompt: 'Already have a page?', label: 'Sign in', href: '/signin' }}
        scene="signup"
      >
        <Callout tone="info">Curios is full for now. Try again soon.</Callout>
      </AuthShell>
    );
  }

  return <SignUp />;
}
