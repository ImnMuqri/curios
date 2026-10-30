/**
 * Which way this browser last signed in, so the sign-in screen can mark it
 * "Last used". Kept in this browser only: it names a method, never an
 * account, so it tells someone at a shared computer nothing about who.
 *
 * Google's sign-in finishes on the API and lands in the dashboard, so the
 * click is only noted as pending. It counts the next time this screen
 * loads without Google having sent the person back cancelled or failed.
 */
export type SignInMethod = 'google' | 'email';

const LAST = 'curios.signin.last';
const PENDING = 'curios.signin.pending';

/** Storage can be missing or throw (private windows, blocked site data); then nothing is remembered. */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberEmailSignIn() {
  try {
    store()?.setItem(LAST, 'email');
  } catch {
    // Not remembered; the screen works without it.
  }
}

export function noteGoogleSignIn() {
  try {
    store()?.setItem(PENDING, 'google');
  } catch {
    // Not remembered; the screen works without it.
  }
}

/** Settles a pending Google sign-in (it counts unless `failed`), then returns the method last used. */
export function lastUsedSignIn(failed: boolean): SignInMethod | null {
  try {
    const s = store();
    if (!s) return null;
    if (s.getItem(PENDING) === 'google') {
      s.removeItem(PENDING);
      if (!failed) s.setItem(LAST, 'google');
    }
    const last = s.getItem(LAST);
    return last === 'google' || last === 'email' ? last : null;
  } catch {
    return null;
  }
}
