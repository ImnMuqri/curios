'use client';

import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api.js';
import styles from './shell.module.css';

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      className={styles.signOut}
      onClick={() => {
        // Leave either way: a failed call means the cookie is already gone or the API is down,
        // and the layout re-checks on the next load.
        void apiFetch('/admin/signout', { method: 'POST' })
          .catch(() => null)
          .then(() => router.replace('/signin'));
      }}
    >
      Sign out
    </button>
  );
}
