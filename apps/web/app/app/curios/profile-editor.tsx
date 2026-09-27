'use client';

import { useState, type ChangeEvent } from 'react';
import { Button, Callout, Field } from '@curios/ui';
import { BIO_MAX } from '@curios/core/bento';
import { ApiError } from '../../../lib/api.js';
import { useAutosave } from './use-autosave.js';
import styles from './curios.module.css';

const STATUS = { idle: '', saving: 'Saving…', saved: 'Saved', error: '' } as const;

/** Name, bio and the optional picture, saved as the owner types or chooses. */
export function ProfileEditor({
  displayName,
  bio,
  onChange,
  save,
  avatarUrl,
  uploadsEnabled,
  onAvatar,
  uploadAvatar,
  removeAvatar,
}: {
  displayName: string;
  bio: string | null;
  onChange: (change: { displayName?: string; bio?: string | null }) => void;
  save: (patch: { displayName?: string; bio?: string | null }) => Promise<unknown>;
  /** The current picture's URL, or null when there is none. */
  avatarUrl: string | null;
  /** Whether storage is configured at all; false hides the picture control entirely. */
  uploadsEnabled: boolean;
  /** Called once an upload or removal has actually taken effect -- never before. */
  onAvatar: (url: string | null) => void;
  uploadAvatar: (file: File) => Promise<string | null>;
  removeAvatar: () => Promise<void>;
}) {
  const name = useAutosave((value: string) => save({ displayName: value }));
  const about = useAutosave((value: string) => save({ bio: value }));
  const [avatarError, setAvatarError] = useState('');
  // The Avatar behaviour: a picture that fails to load disappears rather than
  // showing a broken-image icon, never re-shown for the same URL once it has
  // failed once.
  const [avatarFailed, setAvatarFailed] = useState(false);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared immediately, not after the upload settles: choosing the same
    // file again must fire another change event, and the browser only does
    // that once the input's value has actually changed in between.
    event.target.value = '';
    if (!file) return;
    try {
      // Awaited before onAvatar is ever called -- the picture that lands in
      // state is the one storage actually confirmed, not a guess.
      const url = await uploadAvatar(file);
      setAvatarError('');
      setAvatarFailed(false);
      onAvatar(url);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'That picture could not be used.');
    }
  };

  const handleRemove = async () => {
    try {
      await removeAvatar();
      setAvatarError('');
    } catch {
      setAvatarError('That did not save. Try again.');
    }
  };

  return (
    <section className={styles.section} aria-labelledby="profile-title">
      <h2 id="profile-title" className={styles.sectionTitle}>Profile</h2>
      {uploadsEnabled ? (
        <div className={styles.avatarRow}>
          {avatarUrl && !avatarFailed ? (
            <img src={avatarUrl} alt="" className={styles.avatarPreview} onError={() => setAvatarFailed(true)} />
          ) : (
            <div className={styles.avatarPlaceholder} aria-hidden="true" />
          )}
          <div className={styles.avatarActions}>
            <label className={styles.avatarUpload}>
              <span aria-hidden="true">Upload a picture</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Upload a picture"
                className={styles.visuallyHidden}
                onChange={(event) => { void handleUpload(event); }}
              />
            </label>
            {avatarUrl ? (
              <Button type="button" variant="secondary" onClick={() => { void handleRemove(); }}>
                Remove picture
              </Button>
            ) : null}
          </div>
          <p className={styles.avatarHint}>Optional. No picture? Your page shows just your name.</p>
          {avatarError ? <div className={styles.avatarError}><Callout tone="error">{avatarError}</Callout></div> : null}
        </div>
      ) : null}
      <Field
        id="display-name"
        label="Display name"
        value={displayName}
        onChange={(value) => { onChange({ displayName: value }); name.schedule(value); }}
      />
      <SaveState status={name.status} error={name.error} retry={name.retry} />
      <Field
        id="bio"
        label="Bio"
        multiline
        value={bio ?? ''}
        hint={`${[...(bio ?? '')].length} of ${BIO_MAX}`}
        onChange={(value) => { onChange({ bio: value }); about.schedule(value); }}
      />
      <SaveState status={about.status} error={about.error} retry={about.retry} />
    </section>
  );
}

/**
 * A failed save's own words when it has them (the empty-name or
 * bio-too-long reason from the API, for example) rather than always the
 * same generic sentence -- and a 4xx never offers Retry, because sending the
 * same rejected value again cannot succeed. Anything else (a dropped
 * connection, a 5xx) keeps the generic message and the Retry, since trying
 * again might actually work.
 */
export function SaveState({ status, error, retry }: { status: keyof typeof STATUS; error?: unknown; retry: () => void }) {
  if (status === 'error') {
    const message = error instanceof ApiError ? error.message : 'That did not save.';
    const canRetry = !(error instanceof ApiError && error.status >= 400 && error.status < 500);
    return (
      <p className={styles.saveError} role="alert">
        {message} {canRetry ? <Button type="button" variant="secondary" onClick={retry}>Retry</Button> : null}
      </p>
    );
  }
  return <p className={styles.saveState} aria-live="polite">{STATUS[status]}</p>;
}
