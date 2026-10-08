'use client';

import { useRef, useState } from 'react';
import { Callout } from '@curios/ui';
import { STOCK_COVERS, stockCoverName, type StockCover } from '@curios/core/bento';
import styles from './curios.module.css';

/** What each stock cover shows, for a screen reader and the hover title. */
const STOCK_NAMES: Record<StockCover, string> = {
  kedai: 'Shopfront',
  kopi: 'Coffee',
  dapur: 'Kitchen',
  teh: 'Tea and flowers',
  bunga: 'Flowers',
  manis: 'Berries',
};

/**
 * The cover photo at the top of the page: one of the covers that ship with
 * Curios, the owner's own upload, or none. Every choice saves at once, like
 * the rest of Appearance. A stock cover needs no storage, so it works even
 * where uploads are switched off.
 */
export function CoverEditor({
  coverKey,
  coverUrl,
  uploadsEnabled,
  onCover,
  chooseStock,
  uploadCover,
  removeCover,
}: {
  coverKey: string | null;
  coverUrl: string | null;
  uploadsEnabled: boolean;
  onCover: (cover: { coverKey: string | null; coverUrl: string | null }) => void;
  chooseStock: (name: StockCover) => Promise<{ coverKey: string; coverUrl: string | null }>;
  uploadCover: (file: File) => Promise<{ coverKey: string; coverUrl: string | null }>;
  removeCover: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const chosenStock = stockCoverName(coverKey);

  const run = async (work: () => Promise<{ coverKey: string | null; coverUrl: string | null }>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onCover(await work());
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="cover-title">
      <h2 id="cover-title" className={styles.sectionTitle}>Cover photo</h2>

      {/* One compact row: none, your own upload if there is one, then ours. The preview beside this shows the result. */}
      <div className={styles.coverRow} role="group" aria-labelledby="cover-title">
        <button
          type="button"
          className={`${styles.coverTile} ${styles.coverNone}`}
          aria-pressed={!coverKey}
          disabled={busy}
          onClick={() =>
            coverKey
              ? void run(async () => {
                  await removeCover();
                  return { coverKey: null, coverUrl: null };
                }, 'That did not save. Try again.')
              : undefined
          }
        >
          None
        </button>
        {coverKey && !chosenStock && coverUrl ? (
          <button type="button" className={styles.coverTile} aria-pressed title="Your own photo" disabled={busy}>
            <img src={coverUrl} alt="Your own photo" width={72} height={45} />
          </button>
        ) : null}
        {STOCK_COVERS.map((name) => (
          <button
            key={name}
            type="button"
            className={styles.coverTile}
            aria-pressed={chosenStock === name}
            title={STOCK_NAMES[name]}
            disabled={busy}
            onClick={() => void run(() => chooseStock(name), 'That did not save. Try again.')}
          >
            <img src={`/covers/${name}.webp`} alt={STOCK_NAMES[name]} loading="lazy" width={72} height={45} />
          </button>
        ))}
      </div>

      {/* Always shown, so owners know their own photo is possible; disabled, with the reason, where storage is off. */}
      <div className={styles.coverFoot}>
        <button type="button" className={styles.avatarUpload} data-disabled={!uploadsEnabled} disabled={busy || !uploadsEnabled} onClick={() => file.current?.click()}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          {busy ? 'Saving…' : 'Upload your own'}
        </button>
        <p className={styles.note}>{uploadsEnabled ? 'A wide photo, 2 MB at most.' : 'Uploading your own is switched off here.'}</p>
      </div>
      {uploadsEnabled ? (
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-label="Upload a cover photo"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked) void run(() => uploadCover(picked), 'That picture could not be used.');
          }}
        />
      ) : null}

      {error ? <Callout tone="error">{error}</Callout> : null}
    </section>
  );
}
