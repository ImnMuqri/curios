import { SystemCard, SystemShell, systemStyles as styles } from './SystemShell.js';
import { BrokenLinkArt } from './art.js';

/**
 * "That link doesn't work", from the System board: a reset link that is cut
 * short, too old, already used or never ours. `kind` says which email it came
 * from, because what to ask for next differs: a reset link sends the owner for
 * a new one, a confirmation link back to sign in, where an unconfirmed address
 * gets a fresh link.
 */
export function BadLink({ kind = 'reset', detail }: { kind?: 'reset' | 'verify'; detail?: string }) {
  return (
    <SystemShell>
      <SystemCard
        art={<BrokenLinkArt />}
        title="That link doesn’t work"
        lede={
          kind === 'reset'
            ? 'It’s either incomplete or more than an hour old. Copy the whole link from the email, or ask for a new one.'
            : 'It’s either incomplete or not one we sent. Copy the whole link from the email.'
        }
      >
        {detail ? (
          <p className={styles.alert} role="alert">
            {detail}
          </p>
        ) : null}
        {kind === 'reset' ? (
          <a className={`${styles.go} ${styles.next}`} href="/forgot">
            Send me a new link
          </a>
        ) : null}
        <a className={kind === 'reset' ? styles.ghost : `${styles.ghost} ${styles.next}`} href="/signin">
          Back to sign in
        </a>
      </SystemCard>
    </SystemShell>
  );
}
