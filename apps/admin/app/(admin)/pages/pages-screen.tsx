'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AdminPageDetail, AdminPageRow, PageFilter } from '@curios/db-read/admin';
import { PagePanel } from './page-panel.js';
import { day, STATUS_COLOUR } from './format.js';
import styles from './pages.module.css';

const FILTERS: { key: PageFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'business', label: 'Business' },
  { key: 'personal', label: 'Personal' },
  { key: 'lapsed', label: 'Lapsed' },
  { key: 'flagged', label: 'Hidden or suspended' },
];

/** The list's own address, with whatever of search, filter and open page is set. */
export function pagesHref(p: { q?: string; filter?: PageFilter; page?: string }): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  if (p.filter && p.filter !== 'all') qs.set('filter', p.filter);
  if (p.page) qs.set('page', p.page);
  const s = qs.toString();
  return s ? `/pages?${s}` : '/pages';
}

export function PagesScreen({
  rows,
  q,
  filter,
  selectedId,
  detail,
  appUrl,
}: {
  rows: AdminPageRow[];
  q: string;
  filter: PageFilter;
  selectedId?: string | undefined;
  detail: AdminPageDetail | null;
  appUrl: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <div className={styles.head}>
        <h1>Pages</h1>
        <p>Every page and its owner</p>
      </div>

      <div className={styles.body}>
        <form
          className={styles.tool}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(pagesHref({ q: text.trim(), filter }));
          }}
        >
          <label className={styles.search}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
            </svg>
            <input
              type="search"
              aria-label="Search pages"
              placeholder="Handle, name or owner email"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </form>

        <nav className={styles.tabs} aria-label="Filter pages">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={pagesHref({ q, filter: f.key })}
              className={styles.tab}
              aria-current={f.key === filter ? 'true' : undefined}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        <div className={styles.split}>
          <div className={`${styles.box} ${styles.tw}`}>
            <div className={styles.table} role="table" aria-label="Pages">
              <div className={`${styles.row} ${styles.hd}`} role="row">
                {['Page', 'Owner', 'Kind', 'Created', 'Status'].map((h) => (
                  <div key={h} className={styles.h} role="columnheader">
                    {h}
                  </div>
                ))}
              </div>
              {rows.map((p) => (
                <div
                  key={p.id}
                  className={`${styles.row} ${styles.pick}`}
                  role="row"
                  aria-selected={p.id === selectedId}
                  onClick={() => router.push(pagesHref({ q, filter, page: p.id }))}
                >
                  <div className={styles.c} role="cell">
                    <span className={styles.pg}>
                      <Link href={pagesHref({ q, filter, page: p.id })} onClick={(e) => e.stopPropagation()}>
                        {p.displayName}
                      </Link>
                      <code>curios.my/{p.handle}</code>
                    </span>
                  </div>
                  <div className={styles.c} role="cell">
                    <span className={styles.ellip}>{p.ownerEmail}</span>
                  </div>
                  <div className={styles.c} role="cell">
                    {p.mode === 'BUSINESS' ? 'Business' : 'Personal'}
                  </div>
                  <div className={styles.c} role="cell">
                    {day(p.createdAt)}
                  </div>
                  <div className={styles.c} role="cell">
                    <span className={styles.st}>
                      <i className={styles.dot} style={{ background: STATUS_COLOUR[p.status] }} />
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <div className={styles.empty} role="row">
                  {q ? `No pages match “${q}”.` : 'No pages here yet.'}
                </div>
              )}
            </div>
          </div>

          {detail && (
            <PagePanel
              key={detail.id}
              page={detail}
              appUrl={appUrl}
              listHref={pagesHref({ q, filter })}
              onToast={setToast}
            />
          )}
        </div>
      </div>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
