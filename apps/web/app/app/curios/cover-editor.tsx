'use client';

import { useRef, useState } from 'react';
import { Callout } from '@curios/ui';
import { STOCK_COVERS, stockCoverName, type HeadingFont, type PageBackground, type StockCover } from '@curios/core/bento';
import { themeAttrs } from '../../_bento/BentoPage.js';
import bento from '../../_bento/Bento.module.css';
import { SectionHead } from '../_ui/section-head.js';
import ui from '../_ui/editor.module.css';
import styles from './curios.module.css';

/** What each stock cover shows, for a screen reader and the chosen tile's caption. */
const STOCK_NAMES: Record<StockCover, string> = {
  kedai: 'Shopfront',
  kopi: 'Coffee',
  dapur: 'Kitchen',
  teh: 'Tea and flowers',
  bunga: 'Flowers',
  manis: 'Berries',
};

/**
 * The cover photo at the top of the page, as one strip of tiles: no photo
 * (drawn in the page's own colours), the owner's upload if there is one, the
 * covers that ship with Curios, then a tile to upload. The chosen tile widens
 * and names itself. Every choice saves at once. A stock cover needs no
 * storage, so it works even where uploads are switched off.
 */
export function CoverEditor({
  coverKey,
  coverUrl,
  uploadsEnabled,
  look,
  onCover,
  chooseStock,
  uploadCover,
  removeCover,
}: {
  coverKey: string | null;
  coverUrl: string | null;
  uploadsEnabled: boolean;
  /** The page's colours, for the no-photo tile. */
  look: { accentColor: string; headingFont: HeadingFont; background: PageBackground; backgroundColor: string | null };
  onCover: (cover: { coverKey: string | null; coverUrl: string | null }) => void;
  chooseStock: (name: StockCover) => Promise<{ coverKey: string; coverUrl: string | null }>;
  uploadCover: (file: File) => Promise<{ coverKey: string; coverUrl: string | null }>;
  removeCover: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const chosenStock = stockCoverName(coverKey);
  const ownPhoto = coverKey && !chosenStock && coverUrl ? coverUrl : null;

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
  const remove = () =>
    void run(async () => {
      await removeCover();
      return { coverKey: null, coverUrl: null };
    }, 'That did not save. Try again.');

  return (
    <section className={ui.section} aria-labelledby="cover-title">
      <SectionHead id="cover-title" title="Cover photo" note="Optional. Pick one, upload your own, or go with a solid colour" />

      <div className={styles.gallery} role="group" aria-labelledby="cover-title" aria-busy={busy}>
        <button
          type="button"
          className={styles.galleryTile}
          aria-pressed={!coverKey}
          aria-label="No photo"
          disabled={busy}
          onClick={() => (coverKey ? remove() : undefined)}
        >
          <span className={`${bento.theme} ${styles.solid}`} {...themeAttrs(look)} data-island="" aria-hidden="true">
            <i />
            <em />
            <em />
          </span>
          <span className={styles.caption} aria-hidden="true">No photo</span>
        </button>
        {/* The delete sits beside the tile, not in it: a button cannot hold another. Deleting goes back to No photo. */}
        {ownPhoto ? (
          <span className={styles.ownTile}>
            <button type="button" className={styles.galleryTile} aria-pressed aria-label="Your own photo" disabled={busy}>
              <img src={ownPhoto} alt="" />
              <span className={styles.caption} aria-hidden="true">Your photo</span>
            </button>
            <button type="button" className={styles.deleteCover} aria-label="Delete your photo" title="Delete" disabled={busy} onClick={remove}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
              </svg>
            </button>
          </span>
        ) : null}
        {STOCK_COVERS.map((name) => (
          <button
            key={name}
            type="button"
            className={styles.galleryTile}
            aria-pressed={chosenStock === name}
            aria-label={STOCK_NAMES[name]}
            disabled={busy}
            onClick={() => (chosenStock === name ? undefined : void run(() => chooseStock(name), 'That did not save. Try again.'))}
          >
            <img src={`/covers/${name}.webp`} alt="" loading="lazy" />
            <span className={styles.caption} aria-hidden="true">{STOCK_NAMES[name]}</span>
          </button>
        ))}
        {/* Always shown, so owners know their own photo is possible; disabled, with the reason, where storage is off. */}
        <button
          type="button"
          className={`${styles.galleryTile} ${styles.galleryUpload}`}
          aria-label="Upload your own"
          title={uploadsEnabled ? 'A wide photo, 2 MB at most' : 'Uploading your own is switched off here'}
          disabled={busy || !uploadsEnabled}
          onClick={() => file.current?.click()}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />
          </svg>
        </button>
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
