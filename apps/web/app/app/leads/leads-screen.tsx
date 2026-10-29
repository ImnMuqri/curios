'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatMalaysianPhone } from '@curios/core/phone';
import type { LeadStats, OwnerLead } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { PageHead } from '../_ui/page-head.js';
import ui from '../_ui/editor.module.css';
import inbox from '../_ui/inbox.module.css';
import pills from '../_ui/pill-tabs.module.css';
import { relativeTime } from '../_ui/relative-time.js';
import { useToast } from '../_ui/toast.js';
import { LeadDetail, STATUSES, type LeadActions, type LeadStatus } from './lead-detail.js';
import styles from './leads.module.css';

type Filter = 'all' | LeadStatus;

const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUSES];

/** Whether a lead answers the search box: the number's digits, or what they are after. */
export function leadMatches(lead: OwnerLead, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const wants = [lead.slots?.product, lead.slots?.date, lead.slots?.location].filter(Boolean).join(' ').toLowerCase();
  return (digits.length >= 2 && lead.phone.replace(/\D/g, '').includes(digits)) || wants.includes(q);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Every number a page has captured, newest first: one sentence of figures
 * under the title, the numbers down the left (searched, and filtered by
 * where the owner is with them), and the chosen one on the right with the
 * conversation behind it. The search narrows the fifty on this page.
 *
 * Presentational: it takes the rows and the mutations, and `Leads` below
 * supplies the real ones. A status shows the moment it is chosen and goes
 * back if the save fails; the server is re-read after, for the figures.
 */
export function LeadsScreen({
  leads,
  paging = { older: null, paged: false },
  stats,
  handle,
  displayName,
  language,
  publicUrl,
  now,
  keptMonths,
  actions,
  onChanged,
}: {
  leads: OwnerLead[];
  /** `older`: the last lead shown, when there are more below it. `paged`: this is not the newest page. */
  paging?: { older: string | null; paged: boolean };
  stats: LeadStats;
  handle: string;
  displayName: string;
  language: string;
  /** The page's full address, for "Copy your link". */
  publicUrl: string;
  now: Date;
  /** How long a lead is kept before the retention sweep deletes it. */
  keptMonths: number;
  actions: LeadActions;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, LeadStatus>>({});
  const [copied, setCopied] = useState(false);
  const { say, toast } = useToast();
  // A fresh read from the server is the truth again.
  useEffect(() => setStatuses({}), [leads]);

  const statusOf = (lead: OwnerLead) => statuses[lead.id] ?? lead.status;
  const shown = leads.filter((lead) => (filter === 'all' || statusOf(lead) === filter) && leadMatches(lead, query));
  const chosen = shown.find((lead) => lead.id === selected) ?? shown[0] ?? null;
  const waiting = leads.filter((lead) => statusOf(lead) === 'NEW').length;

  async function setStatus(lead: OwnerLead, next: LeadStatus) {
    const before = statusOf(lead);
    setStatuses((current) => ({ ...current, [lead.id]: next }));
    try {
      await actions.setStatus(lead.id, next);
      onChanged();
    } catch (failure) {
      setStatuses((current) => ({ ...current, [lead.id]: before }));
      throw failure;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the address is in the page's own header to select.
    }
  }

  return (
    <>
      <PageHead
        title="Leads"
        summary={
          <>
            <b>{plural(stats.waiting, 'new number')}</b> {stats.waiting === 1 ? 'is' : 'are'} waiting for you. {plural(stats.thisWeek, 'person', 'people')} left their number this
            week, and {stats.sold} became {stats.sold === 1 ? 'a sale' : 'sales'}.
          </>
        }
      />

      {leads.length === 0 ? (
        <div className={inbox.board} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className={inbox.detail} style={{ display: 'grid', placeItems: 'center', minHeight: 420 }}>
            <div className={ui.empty} style={{ border: 0 }}>
              <div className={ui.emptyArt} aria-hidden="true">
                <span className={ui.ghostRows}>
                  <span data-tone="rose">
                    <i />
                    <b />
                    <em />
                  </span>
                  <span data-tone="biru">
                    <i />
                    <b />
                    <em />
                  </span>
                  <span data-tone="hijau">
                    <i />
                    <b />
                    <em />
                  </span>
                </span>
                <span className={ui.emptyBadge} data-tone="rose">
                  <svg viewBox="0 0 24 24" width="21" height="21">
                    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
                  </svg>
                </span>
              </div>
              <h3>No numbers yet</h3>
              <p>When the chat can&apos;t answer, it offers to pass the question to you. Numbers people leave show up here, with what they were asking.</p>
              <button type="button" className={ui.primaryButton} onClick={() => void copyLink()}>
                {copied ? 'Copied' : 'Copy your link'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={inbox.board}>
          <div className={inbox.list}>
            <label className={inbox.search}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input type="search" value={query} placeholder="Search number or what they want" aria-label="Search number or what they want" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className={`${pills.track} ${inbox.filters}`} role="tablist" aria-label="Show leads" style={{ '--n': FILTERS.length } as CSSProperties}>
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" className={`${pills.pill} ${inbox.filter}`} aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  {f.id === 'NEW' && waiting > 0 ? <span className={`${pills.count} ${inbox.count}`}>{waiting}</span> : null}
                </button>
              ))}
            </div>
            {shown.length === 0 && query.trim() ? (
              <p className={inbox.listEmpty}>
                <b>No match</b>
                No number here matches “{query.trim()}”.
              </p>
            ) : shown.length === 0 ? (
              <p className={inbox.listEmpty}>
                <b>All clear</b>
                {filter === 'NEW' ? 'New numbers land here as people leave them.' : 'Nothing here yet.'}
              </p>
            ) : (
              <ul className={inbox.rows} aria-label="Leads">
                {shown.map((lead, i) => {
                  const status = statusOf(lead);
                  const wants = [lead.slots?.product, lead.slots?.date, lead.slots?.location].filter(Boolean).join(' · ');
                  return (
                    <li key={lead.id}>
                      <button
                        type="button"
                        className={inbox.row}
                        aria-current={chosen?.id === lead.id}
                        style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                        onClick={() => setSelected(lead.id)}
                      >
                        <span className={styles.lead}>
                          <span className={styles.leadMid}>
                            <span className={styles.phone}>
                              {formatMalaysianPhone(lead.phone)}
                              {status === 'NEW' ? <span className={styles.newDot} aria-label="New" /> : null}
                            </span>
                            <span className={styles.wants}>{wants || 'Nothing picked out yet'}</span>
                          </span>
                          <span className={styles.leadEnd}>
                            <span>{relativeTime(lead.createdAt, now)}</span>
                            <span className={styles.heat} data-score={Math.max(0, Math.min(3, lead.score))} aria-label={`${lead.score} of 3 details`}>
                              <i />
                              <i />
                              <i />
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {paging.older || paging.paged ? (
              <nav className={inbox.pager} aria-label="More leads">
                {paging.paged ? <Link href="/app/leads">Newest</Link> : null}
                {paging.older ? <Link href={`/app/leads?before=${encodeURIComponent(paging.older)}`}>Older leads</Link> : null}
              </nav>
            ) : null}
            <p className={inbox.listNote}>Numbers visitors left in the chat · kept for {keptMonths} months</p>
          </div>
          <div className={inbox.detail}>
            {chosen ? (
              <LeadDetail
                key={chosen.id}
                lead={chosen}
                status={statusOf(chosen)}
                handle={handle}
                displayName={displayName}
                language={language}
                now={now}
                actions={actions}
                onStatus={(next) => setStatus(chosen, next)}
                say={say}
                onDeleted={() => {
                  setSelected(null);
                  say('Lead deleted.');
                  onChanged();
                }}
              />
            ) : null}
          </div>
        </div>
      )}
      {toast}
    </>
  );
}

/** Supplies the real mutations; a Server Component may not hand closures across the RSC boundary. */
export function Leads(props: Omit<Parameters<typeof LeadsScreen>[0], 'actions' | 'onChanged' | 'now'> & { now: string }) {
  const router = useRouter();
  const actions: LeadActions = {
    setStatus: async (id, status) => {
      await apiFetch(`/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    remove: async (id) => {
      await apiFetch(`/leads/${id}`, { method: 'DELETE' });
    },
  };
  return <LeadsScreen {...props} now={new Date(props.now)} actions={actions} onChanged={() => router.refresh()} />;
}
