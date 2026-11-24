import type { Metadata } from 'next';
import { Callout } from '@curios/ui';
import { getSettings } from '@curios/db-read';
import { connectToApi } from '../../lib/api-hints.js';
import { AuthShell } from '../_auth/AuthShell.js';
import { SignUp } from './signup-form.js';
import { SIGNUP_TITLE } from './signup-title.js';
import styles from '../auth.module.css';

export const metadata: Metadata = {
  title: 'Create your free page · Curios',
  description: 'Claim your curios.my address and make a link in bio people can ask. Free for anyone.',
};

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
      <AuthShell title={SIGNUP_TITLE}>
        <Callout tone="info">Curios is full for now. Try again soon.</Callout>
        <p className={`${styles.fine} ${styles.phoneOnly}`}>
          Already have a page? <a href="/signin">Sign in</a>
        </p>
      </AuthShell>
    );
  }

  connectToApi();
  return <SignUp />;
}
