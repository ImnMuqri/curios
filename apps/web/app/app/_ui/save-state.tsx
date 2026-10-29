'use client';

import { Button } from '@curios/ui';
import { ApiError } from '../../../lib/api.js';
import styles from './editor.module.css';

/**
 * A failed save, said under its field: the API's own words when it has them
 * (the empty-name or bio-too-long reason, for example) rather than always the
 * same generic sentence -- and a 4xx never offers Retry, because sending the
 * same rejected value again cannot succeed. Anything else (a dropped
 * connection, a 5xx) keeps the generic message and the Retry, since trying
 * again might actually work. While saving or saved it shows nothing: the
 * header's status says that for the whole screen.
 */
export function SaveState({ status, error, retry }: { status: 'idle' | 'saving' | 'saved' | 'error'; error?: unknown; retry: () => void }) {
  if (status !== 'error') return null;
  const message = error instanceof ApiError ? error.message : 'That did not save.';
  const canRetry = !(error instanceof ApiError && error.status >= 400 && error.status < 500);
  return (
    <p className={styles.saveError} role="alert">
      {message}{' '}
      {canRetry ? (
        <Button type="button" variant="secondary" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </p>
  );
}
