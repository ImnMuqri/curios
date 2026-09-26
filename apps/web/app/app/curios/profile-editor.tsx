'use client';

import { Button, Field } from '@curios/ui';
import { BIO_MAX } from '@curios/core/bento';
import { useAutosave } from './use-autosave.js';
import styles from './curios.module.css';

const STATUS = { idle: '', saving: 'Saving…', saved: 'Saved', error: '' } as const;

/** Name and bio, saved as the owner types. The picture control lives here too, from Task 9. */
export function ProfileEditor({
  displayName,
  bio,
  onChange,
  save,
}: {
  displayName: string;
  bio: string | null;
  onChange: (change: { displayName?: string; bio?: string | null }) => void;
  save: (patch: { displayName?: string; bio?: string | null }) => Promise<unknown>;
}) {
  const name = useAutosave((value: string) => save({ displayName: value }));
  const about = useAutosave((value: string) => save({ bio: value }));

  return (
    <section className={styles.section} aria-labelledby="profile-title">
      <h2 id="profile-title" className={styles.sectionTitle}>Profile</h2>
      <Field
        id="display-name"
        label="Display name"
        value={displayName}
        onChange={(value) => { onChange({ displayName: value }); name.schedule(value); }}
      />
      <SaveState status={name.status} retry={name.retry} />
      <Field
        id="bio"
        label="Bio"
        multiline
        value={bio ?? ''}
        hint={`${[...(bio ?? '')].length} of ${BIO_MAX}`}
        onChange={(value) => { onChange({ bio: value }); about.schedule(value); }}
      />
      <SaveState status={about.status} retry={about.retry} />
    </section>
  );
}

export function SaveState({ status, retry }: { status: keyof typeof STATUS; retry: () => void }) {
  if (status === 'error') {
    return (
      <p className={styles.saveError} role="alert">
        That did not save. <Button type="button" variant="secondary" onClick={retry}>Retry</Button>
      </p>
    );
  }
  return <p className={styles.saveState} aria-live="polite">{STATUS[status]}</p>;
}
