'use client';

import { useEffect, useState } from 'react';
import { SystemCard, SystemShell, systemStyles as styles } from './_system/SystemShell.js';
import { UnpluggedArt } from './_system/art.js';

/**
 * Something broke on our side, from the System board. "Try again" re-renders
 * the screen that failed; the error ref is Next's digest, which matches the
 * server's log line, so a person quoting it can be helped.
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // A retry that fails again lands back here with a new error; that is the
  // moment to let go of "Trying…".
  useEffect(() => setTrying(false), [error]);

  return (
    <SystemShell>
      <SystemCard art={<UnpluggedArt />} title="Something broke on our side" lede="Not you, us. Nothing you did was lost. Try again in a moment.">
        <button
          type="button"
          className={`${styles.go} ${styles.next}`}
          disabled={trying}
          onClick={() => {
            setTrying(true);
            reset();
          }}
        >
          {trying ? 'Trying…' : 'Try again'}
        </button>
        <a className={styles.ghost} href="/">
          Go to Curios
        </a>
        {error.digest ? <p className={`${styles.again} ${styles.ref}`}>Error ref {error.digest}</p> : null}
      </SystemCard>
    </SystemShell>
  );
}
