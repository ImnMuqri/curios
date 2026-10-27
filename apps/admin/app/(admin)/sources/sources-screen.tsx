'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SourceFilter, SourceRow, SourceStats, SourceStatus } from '@curios/db-read/admin';
import { apiFetch } from '../../../lib/api.js';
import { ago } from '../ago.js';
import { ReasonDialog } from '../reason-dialog.js';
import { said } from '../said.js';
import ui from '../ui.module.css';
import styles from './sources.module.css';

const int = (n: number) => n.toLocaleString('en-US');

const TABS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'failed', label: 'Couldn’t read' },
  { key: 'done', label: 'Done' },
];

/** The board's status colours. */
const STATUS_COLOUR: Record<SourceStatus, string> = {
  Reading: '#2340c8',
  Done: '#1d9a6c',
  Walled: '#f2a33c',
  Failed: '#d8452f',
  Queued: '#9aa0ab',
};

const hrefFor = (filter: SourceFilter) => (filter === 'all' ? '/sources' : `/sources?filter=${filter}`);

type Ask = { kind: 'retry'; row: SourceRow } | { kind: 'retryAll' } | { kind: 'pause' };

const HEADS: [string, boolean][] = [
  ['Page', false],
  ['Source', false],
  ['Status', false],
  ['Facts', true],
  ['Started', false],
  ['', false],
];

export function SourcesScreen({
  rows,
  stats,
  filter,
  readingOn,
  now,
}: {
  rows: SourceRow[];
  stats: SourceStats;
  filter: SourceFilter;
  /** The reading switch: off is the paused queue. */
  readingOn: boolean;
  now: Date;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<Ask | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /** One change through the API: the API's words on a refusal, then the screen's data and a toast. */
  async function send(run: () => Promise<unknown>, done: string | ((result: unknown) => string)) {
    setError(null);
    let result: unknown;
    try {
      result = await run();
    } catch (e) {
      throw said(e);
    }
    router.refresh();
    setAsking(null);
    setToast(typeof done === 'function' ? done(result) : done);
  }

  const post = (path: string, reason: string) =>
    apiFetch(path, { method: 'POST', body: JSON.stringify({ reason }) });

  async function resume() {
    setBusy(true);
    try {
      await send(
        () => apiFetch('/admin/settings/switches/reading', { method: 'PUT', body: JSON.stringify({ on: true }) }),
        'Reading is on again.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const figures: { value: string; label: string; note: string; red: boolean; good?: boolean }[] = [
    {
      value: int(stats.waiting),
      label: 'Waiting',
      note: readingOn ? 'Starts within a minute' : 'Queue paused',
      red: !readingOn,
    },
    { value: int(stats.reading), label: 'Reading now', note: '', red: false },
    { value: int(stats.failedToday), label: 'Couldn’t be read, today', note: '', red: false },
    {
      value: stats.typicalMs === null ? '—' : `${Math.round(stats.typicalMs / 1000)}s`,
      label: 'Typical read time',
      note: stats.typicalMs === null ? '' : 'A website, start to facts',
      red: false,
    },
  ];

  return (
    <>
      <div className={ui.head}>
        <h1>Reading sources</h1>
        <p>Pages reading a website, a file or pasted text</p>
      </div>

      <div className={ui.body}>
        <div className={ui.stats}>
          {figures.map((f) => (
            <div key={f.label} className={ui.stat}>
              <b>{f.value}</b>
              <span>{f.label}</span>
              <small className={f.red ? undefined : ui.soft} style={f.red ? { color: '#b4321f' } : undefined}>
                {f.note}
              </small>
            </div>
          ))}
        </div>

        <div className={styles.tool}>
          <nav className={styles.tabs} aria-label="Filter reads">
            {TABS.map((tab) => (
              <Link key={tab.key} href={hrefFor(tab.key)} className={styles.tab} aria-current={tab.key === filter ? 'true' : undefined}>
                {tab.label}
                <small>{int(stats.counts[tab.key])}</small>
              </Link>
            ))}
          </nav>
          <span className={styles.fill} />
          <button
            type="button"
            className={ui.ghost}
            disabled={busy}
            onClick={() => (readingOn ? setAsking({ kind: 'pause' }) : void resume())}
          >
            {readingOn ? 'Pause the queue' : 'Resume the queue'}
          </button>
          <button
            type="button"
            className={ui.prim}
            disabled={stats.retryable === 0}
            onClick={() => setAsking({ kind: 'retryAll' })}
          >
            Retry all failed
          </button>
        </div>
        {error && (
          <p className={ui.err} role="alert">
            {error}
          </p>
        )}

        <div className={`${ui.box} ${ui.tw}`}>
          <div
            className={ui.t}
            role="table"
            aria-label="Reading sources"
            style={{ '--cols': 'minmax(170px,1.4fr) minmax(190px,1.6fr) minmax(150px,1.3fr) 60px 100px 90px', '--minw': '800px' } as CSSProperties}
          >
            <div className={ui.r} role="row">
              {HEADS.map(([h, right], i) => (
                <div key={i} className={right ? `${ui.h} ${ui.right}` : ui.h} role="columnheader">
                  {h}
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.id} className={ui.r} role="row">
                <div className={ui.c} role="cell">
                  <span className={ui.pg}>
                    <b>{r.displayName}</b>
                    <code>curios.my/{r.handle}</code>
                  </span>
                </div>
                <div className={ui.c} role="cell">
                  <span className={`${ui.mono} ${styles.src}`}>{r.source}</span>
                </div>
                <div className={ui.c} role="cell">
                  <span className={ui.st}>
                    <i style={{ background: STATUS_COLOUR[r.status] }} />
                    {r.status}
                  </span>
                  {r.error && <small className={styles.errline}>{r.error}</small>}
                </div>
                <div className={`${ui.c} ${ui.right}`} role="cell">
                  {r.facts > 0 ? int(r.facts) : '-'}
                </div>
                <div className={ui.c} role="cell">
                  {ago(r.startedAt, now)}
                </div>
                <div className={`${ui.c} ${ui.right}`} role="cell">
                  {r.status === 'Failed' && (
                    <button type="button" className={`${ui.ghost} ${ui.small}`} onClick={() => setAsking({ kind: 'retry', row: r })}>
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className={ui.r} role="row">
                <div className={ui.empty} role="cell">
                  Nothing here.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {asking?.kind === 'retry' && (
        <ReasonDialog
          title="Read this source again?"
          text={`${asking.row.displayName}’s source goes back in the queue.`}
          confirmLabel="Retry"
          placeholder="E.g. The site is back"
          onConfirm={(reason) => send(() => post(`/admin/sources/${encodeURIComponent(asking.row.id)}/retry`, reason), 'Queued again.')}
          onClose={() => setAsking(null)}
        />
      )}
      {asking?.kind === 'retryAll' && (
        <ReasonDialog
          title="Read every failed source again?"
          text="They go back in the queue. Sources from sites that refuse readers are skipped."
          confirmLabel="Retry all failed"
          placeholder="E.g. The outage is over"
          onConfirm={(reason) =>
            send(
              () => post('/admin/sources/retry-failed', reason),
              (result) => {
                const { queued, skipped } = (result ?? {}) as { queued?: number; skipped?: number };
                if (queued === 0) return skipped ? 'Nothing to retry. Walled sources are skipped.' : 'Nothing to retry from the last 7 days.';
                return 'Failed reads queued again. Walled ones are skipped.';
              },
            )
          }
          onClose={() => setAsking(null)}
        />
      )}
      {asking?.kind === 'pause' && (
        <ReasonDialog
          title="Pause reading new sources?"
          text="Owners can still add sources, but they wait in the queue until you resume. Retries are refused while it is paused."
          confirmLabel="Pause the queue"
          placeholder="E.g. The model provider is down"
          onConfirm={(reason) =>
            send(
              () => apiFetch('/admin/settings/switches/reading', { method: 'PUT', body: JSON.stringify({ on: false, reason }) }),
              'Reading is paused.',
            )
          }
          onClose={() => setAsking(null)}
        />
      )}

      {toast && (
        <div className={ui.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
