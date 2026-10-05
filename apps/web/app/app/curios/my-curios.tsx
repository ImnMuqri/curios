'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import type { MyCurios } from '@curios/db-read';
import type { HeadingFont, PageBackground, PageStyle, StockCover, TileSize } from '@curios/core/bento';
import { BentoPage } from '../../_bento/BentoPage.js';
import { Device } from '../../_landing/Device.js';
import { AppearanceEditor } from './appearance-editor.js';
import { CoverEditor } from './cover-editor.js';
import { LinksEditor, type LinkItem } from './links-editor.js';
import { ProfileEditor } from './profile-editor.js';
import styles from './curios.module.css';

export type AppearancePatch = Partial<{ background: PageBackground; style: PageStyle; accentColor: string; headingFont: HeadingFont; displayName: string; bio: string | null }>;

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
  /** Each resolves to the new cover's key and URL. */
  chooseStockCover: (name: StockCover) => Promise<{ coverKey: string; coverUrl: string | null }>;
  uploadCover: (file: File) => Promise<{ coverKey: string; coverUrl: string | null }>;
  removeCover: () => Promise<void>;
}

/**
 * My Curios: the owner's page, arranged. Controls on the left, the live preview
 * on the right (below on a phone), rendered by the same BentoPage visitors see.
 * State is local and optimistic; each section saves its own changes.
 */
/**
 * The editor's three parts, one at a time, chosen from an icon rail on the
 * left. Every panel stays mounted and is only hidden: the name and bio
 * autosave on a debounce, and unmounting a panel mid-typing would drop the
 * save that was about to happen.
 */
const TABS = [
  {
    id: 'profile',
    label: 'Profile',
    hint: 'Profile: cover photo, picture, name and bio',
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  },
  {
    id: 'links',
    label: 'Links',
    hint: 'Links: what your page links to, and each tile\'s size',
    icon: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    hint: 'Appearance: background, style, colour and font',
    icon: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.6-4-8.2-9-8.2z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10.5" cy="7" r="1.2" /><circle cx="15" cy="7.5" r="1.2" /></>,
  },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function MyCuriosEditor({
  initial,
  api,
  uploadsEnabled,
}: {
  initial: MyCurios & { avatarUrl: string | null; coverUrl: string | null };
  api: CuriosApi;
  uploadsEnabled: boolean;
}) {
  const [page, setPage] = useState(initial);
  const update = (change: Partial<typeof page>) => setPage((current) => ({ ...current, ...change }));
  const [tab, setTab] = useState<Tab>('profile');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // A vertical tab list's keys: up and down move between tabs and select, Home and End jump.
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((t) => t.id === tab);
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <div className={styles.editor} data-fit-screen>
      <div className={styles.controls}>
        <header className={styles.intro}>
          <h1 className={styles.title}>My Curios</h1>
          <p className={styles.lede}>Your page, arranged. Changes save as you make them.</p>
        </header>
        <div className={styles.workspace}>
        <div className={styles.rail} role="tablist" aria-label="Edit" aria-orientation="vertical">
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              aria-label={t.label}
              title={t.hint}
              tabIndex={tab === t.id ? 0 : -1}
              className={styles.railTab}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                {t.icon}
              </svg>
            </button>
          ))}
        </div>
        <div className={styles.panels}>
        <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile" hidden={tab !== 'profile'}>
        <CoverEditor
          coverKey={page.coverKey}
          coverUrl={page.coverUrl}
          uploadsEnabled={uploadsEnabled}
          onCover={update}
          chooseStock={api.chooseStockCover}
          uploadCover={api.uploadCover}
          removeCover={api.removeCover}
        />
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
        </div>
        <div role="tabpanel" id="panel-links" aria-labelledby="tab-links" hidden={tab !== 'links'}>
        <LinksEditor
          links={page.links}
          onChange={(links) => update({ links })}
          addLink={api.addLink}
          updateLink={api.updateLink}
          removeLink={api.removeLink}
          reorder={api.reorder}
        />
        </div>
        <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" hidden={tab !== 'appearance'}>
        <AppearanceEditor
          background={page.background}
          style={page.style}
          accentColor={page.accentColor}
          headingFont={page.headingFont}
          onChange={update}
          save={api.saveAppearance}
        />
        </div>
        </div>
        </div>
      </div>
      <section className={styles.preview} aria-label="Live preview">
        <Device time="9:41" chrome="browser" url={`curios.my/${page.handle}`} className={styles.device}>
          <div className={styles.phone}>
            <BentoPage {...page} interactive={false} />
          </div>
        </Device>
      </section>
    </div>
  );
}
