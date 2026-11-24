'use client';

import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Callout } from '@curios/ui';
import { BIO_MAX } from '@curios/core/bento';
import { SaveState } from '../_ui/save-state.js';
import { useAutosave } from '../_ui/use-autosave.js';
import { SectionHead } from '../_ui/section-head.js';
import ui from '../_ui/editor.module.css';
import styles from './curios.module.css';

/**
 * The picture, name and bio, saved as the owner chooses or types. The picture
 * is changed with the button beside it. The header's status says
 * when a save is under way; a failed one is said here, under its field.
 */
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
  /** Whether storage is configured at all; false shows the picture control disabled, with the reason. */
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
  const file = useRef<HTMLInputElement>(null);
  const bioLength = [...(bio ?? '')].length;

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Cleared immediately, not after the upload settles: choosing the same
    // file again must fire another change event, and the browser only does
    // that once the input's value has actually changed in between.
    event.target.value = '';
    if (!picked) return;
    try {
      // Awaited before onAvatar is ever called -- the picture that lands in
      // state is the one storage actually confirmed, not a guess.
      const url = await uploadAvatar(picked);
      setAvatarError('');
      setAvatarFailed(false);
      onAvatar(url);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'That picture could not be used.');
    }
  };

  const nameId = useId();
  const bioId = useId();
  const hintId = useId();

  const handleRemove = async () => {
    try {
      await removeAvatar();
      setAvatarError('');
    } catch {
      setAvatarError('That did not save. Try again.');
    }
  };

  const hasPicture = Boolean(avatarUrl && !avatarFailed);

  return (
    <section className={ui.section} aria-labelledby="profile-title">
      <SectionHead id="profile-title" title="You" note="Your picture, name and a line people read first." />
      <div className={styles.you}>
        {/* The picture on its own row; the button beside it is what opens the file picker (24 Nov). */}
        <div className={styles.youTop}>
          <span className={styles.avatar} aria-hidden="true">
            {hasPicture ? (
              <img src={avatarUrl ?? ''} alt="" onError={() => setAvatarFailed(true)} />
            ) : (
              <svg viewBox="0 0 24 24" width="32" height="32">
                <circle cx="12" cy="9" r="4" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
            )}
          </span>
          <div className={styles.youAct}>
            <b>Your picture</b>
            <small>Square, at least 400 × 400</small>
            <div className={styles.youBtns}>
              <button
                type="button"
                className={styles.changeButton}
                aria-label={hasPicture ? 'Change profile picture' : 'Add a profile picture'}
                title={uploadsEnabled ? undefined : 'Uploading pictures is switched off here'}
                disabled={!uploadsEnabled}
                onClick={() => file.current?.click()}
              >
                {hasPicture ? 'Change' : 'Add'}
              </button>
              {hasPicture && uploadsEnabled ? (
                <button type="button" className={styles.quietButton} aria-label="Remove picture" onClick={() => void handleRemove()}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
          {uploadsEnabled ? (
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              aria-label="Picture file"
              onChange={(event) => void handleUpload(event)}
            />
          ) : null}
        </div>
        {/* Name and bio stacked full width, each label above its field and tied to it. */}
        <label className={styles.youLabel} htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className={styles.youField}
          // "Name" on screen, as the board has it; "Display name" to a screen reader, apart from a link's Name.
          aria-label="Display name"
          value={displayName}
          autoComplete="off"
          onChange={(event) => {
            onChange({ displayName: event.target.value });
            name.schedule(event.target.value);
          }}
        />
        <SaveState status={name.status} error={name.error} retry={name.retry} />
        <label className={styles.youLabel} htmlFor={bioId}>
          Bio
        </label>
        {/* The count sits inside the field, bottom right, and is not part of the field's name. */}
        <div className={`${styles.youField} ${styles.youBio}`}>
          <textarea
            id={bioId}
            aria-describedby={hintId}
            value={bio ?? ''}
            onChange={(event) => {
              onChange({ bio: event.target.value });
              about.schedule(event.target.value);
            }}
          />
          <em aria-hidden="true" data-over={bioLength > BIO_MAX || undefined}>
            {bioLength} / {BIO_MAX}
          </em>
        </div>
        <SaveState status={about.status} error={about.error} retry={about.retry} />
        <p className={styles.youHint} id={hintId}>
          One line people read before they ask. Mention where you are and how to order.
        </p>
      </div>
      {avatarError ? <Callout tone="error">{avatarError}</Callout> : null}
    </section>
  );
}
