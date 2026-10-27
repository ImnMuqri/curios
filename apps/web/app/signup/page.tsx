import { Callout } from '@curios/ui';
import { getSettings } from '@curios/db-read';
import { AuthShell } from '../_auth/AuthShell.js';
import { SignUp } from './signup-form.js';

// Read per request: the admin closing sign-ups must show here within the settings' 30 seconds.
export const dynamic = 'force-dynamic';

/**
 * Sign up, or -- while the admin has sign-ups closed -- the line that says Curios is full, in
 * place of Google and the form. Only the switch decides: the `closed=1` the API's Google
 * callback adds is ignored, so a link kept from a closed day never says full once sign-ups are
 * open (inside the cache's window the API's own 503 says it instead). English only, as the rest
 * of this screen is. `searchParams` is taken and left unread for that reason.
 */
export default async function SignUpPage(_props: { searchParams: Promise<{ closed?: string }> }) {
  const { switches } = await getSettings();

  if (!switches.signups) {
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
