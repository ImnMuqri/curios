'use client';

import { useEffect, useState } from 'react';
import { SystemActions, SystemCard, SystemShell, systemStyles as styles } from './_system/SystemShell.js';
import { UnpluggedArt } from './_system/art.js';
import { reportClientError } from '../lib/report-client-error.js';

/**
 * Something broke on our side, from the Site board. "Try again" re-renders
 * the screen that failed. The error ref is Next's digest, which matches the
 * server's log line, so a person quoting it can be helped: the board leaves
 * it out, we keep it as one small muted line (DEVIATIONS 386).
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);

  // A retry that fails again lands back here with a new error; that is the
  // moment to let go of "Trying…".
  useEffect(() => setTrying(false), [error]);

  return (
    <SystemShell>
      <SystemCard art={<UnpluggedArt />} title="Something broke on our side" lede="Not you, us. Nothing you did was lost. Try again in a moment.">
        <SystemActions>
          <button
            type="button"
            className={styles.go}
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
        </SystemActions>
        {error.digest ? <p className={styles.ref}>Error ref {error.digest}</p> : null}
      </SystemCard>
    </SystemShell>
  );
}
