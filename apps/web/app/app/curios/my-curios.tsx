'use client';

import { useState } from 'react';
import type { MyCurios } from '@curios/db-read';
import type { HeadingFont, PageStyle, TileSize } from '@curios/core/bento';
import { BentoPage } from '../../_bento/BentoPage.js';
import { AppearanceEditor } from './appearance-editor.js';
import { LinksEditor, type LinkItem } from './links-editor.js';
import { ProfileEditor } from './profile-editor.js';
import styles from './curios.module.css';

export type AppearancePatch = Partial<{ style: PageStyle; accentColor: string; headingFont: HeadingFont; displayName: string; bio: string | null }>;

// Function-typed properties, not method shorthand: several of these are handed
// to child components as bare values (`addLink={api.addLink}`), and TS method
// syntax carries an implicit `this` that `@typescript-eslint/unbound-method`
// rightly distrusts once detached from `api`.
export interface CuriosApi {
  addLink: (input: { label: string; url: string }) => Promise<LinkItem>;
  updateLink: (id: string, patch: Partial<{ label: string; url: string; size: TileSize | null }>) => Promise<LinkItem>;
  removeLink: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  saveAppearance: (patch: AppearancePatch) => Promise<unknown>;
  /** Resolves to the new picture's URL. */
  uploadAvatar: (file: File) => Promise<string | null>;
  removeAvatar: () => Promise<void>;
}

/**
 * My Curios: the owner's page, arranged. Controls on the left, the live preview
 * on the right (below on a phone), rendered by the same BentoPage visitors see.
 * State is local and optimistic; each section saves its own changes.
 */
export function MyCuriosEditor({
  initial,
  api,
  uploadsEnabled,
}: {
  initial: MyCurios & { avatarUrl: string | null };
  api: CuriosApi;
  uploadsEnabled: boolean;
}) {
  const [page, setPage] = useState(initial);
  const update = (change: Partial<typeof page>) => setPage((current) => ({ ...current, ...change }));

  return (
    <div className={styles.editor}>
      <div className={styles.controls}>
        <h1 className={styles.title}>My Curios</h1>
        <p className={styles.lede}>Your page, arranged. Changes save as you make them.</p>
        <ProfileEditor
          displayName={page.displayName}
          bio={page.bio}
          onChange={update}
          save={api.saveAppearance}
          avatarUrl={page.avatarUrl}
          uploadsEnabled={uploadsEnabled}
          onAvatar={(url) => update({ avatarUrl: url })}
          uploadAvatar={api.uploadAvatar}
          removeAvatar={async () => { await api.removeAvatar(); update({ avatarUrl: null }); }}
        />
        <LinksEditor
          links={page.links}
          onChange={(links) => update({ links })}
          addLink={api.addLink}
          updateLink={api.updateLink}
          removeLink={api.removeLink}
          reorder={api.reorder}
        />
        <AppearanceEditor
          style={page.style}
          accentColor={page.accentColor}
          headingFont={page.headingFont}
          onChange={update}
          save={api.saveAppearance}
        />
      </div>
      <section className={styles.preview} aria-label="Live preview">
        <div className={styles.phone}>
          <BentoPage {...page} interactive={false} />
        </div>
      </section>
    </div>
  );
}
