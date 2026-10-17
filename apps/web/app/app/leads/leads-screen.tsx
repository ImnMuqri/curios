'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { formatMalaysianPhone } from '@curios/core/phone';
import type { LeadStats, OwnerLead } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { PageHead } from '../_ui/page-head.js';
import ui from '../_ui/editor.module.css';
import inbox from '../_ui/inbox.module.css';
import { relativeTime } from '../_ui/relative-time.js';
import { LeadDetail, PhoneSquare, STATUSES, type LeadActions, type LeadStatus } from './lead-detail.js';
import styles from './leads.module.css';

type Filter = 'all' | LeadStatus;

const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUSES];

/**
 * Every number a page has captured, newest first: three figures, the
 * numbers down the left (filtered by where the owner is with them), and the
 * chosen one on the right with the conversation behind it.
 *
 * Presentational: it takes the rows and the mutations, and `Leads` below
 * supplies the real ones. A status shows the moment it is chosen and goes
 * back if the save fails; the server is re-read after, for the figures.
 */
export function LeadsScreen({
  leads,
  stats,
  handle,
  displayName,
  language,
  publicUrl,
  look,
  now,
  actions,
  onChanged,
}: {
  leads: OwnerLead[];
  stats: LeadStats;
  handle: string;
  displayName: string;
  language: string;
  /** The page's full address, for "Copy your link". */
  publicUrl: string;
  look: Parameters<typeof LeadDetail>[0]['look'];
  now: Date;
  actions: LeadActions;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, LeadStatus>>({});
  const [copied, setCopied] = useState(false);
  // A fresh read from the server is the truth again.
  useEffect(() => setStatuses({}), [leads]);

  const statusOf = (lead: OwnerLead) => statuses[lead.id] ?? lead.status;
  const shown = leads.filter((lead) => filter === 'all' || statusOf(lead) === filter);
  const chosen = shown.find((lead) => lead.id === selected) ?? shown[0] ?? null;
  const waiting = leads.filter((lead) => statusOf(lead) === 'NEW').length;
  const top = Math.max(1, ...stats.week);

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
      <PageHead title="Leads" note="Numbers visitors left in the chat" />

      <ul className={inbox.stats} aria-label="Your leads">
        <li className={inbox.kpi}>
          <span className={inbox.kpiIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
            </svg>
          </span>
          <span>
            <b>{stats.waiting}</b>
            <span>New, waiting for you</span>
          </span>
        </li>
        <li className={inbox.kpi}>
          <span className={inbox.kpiIcon} data-tone="hijau" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M4 20l1.4-4.2A8 8 0 1 1 8.6 19z" />
            </svg>
          </span>
          <span>
            <b>{stats.week.reduce((sum, n) => sum + n, 0)}</b>
            <span>Numbers left this week</span>
          </span>
          <span className={styles.week} aria-hidden="true">
            {stats.week.map((n, i) => (
              <i key={i} style={{ height: Math.max(4, Math.round((n / top) * 34)) }} />
            ))}
          </span>
        </li>
        <li className={inbox.kpi}>
          <span className={inbox.kpiIcon} data-tone="rose" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
            </svg>
          </span>
          <span>
            <b>{stats.closed}</b>
            <span>Marked closed</span>
          </span>
        </li>
      </ul>

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
            <div
              className={inbox.filters}
              role="tablist"
              aria-label="Show leads"
              style={
                {
                  '--at': FILTERS.findIndex((f) => f.id === filter),
                  '--n': FILTERS.length,
                } as CSSProperties
              }
            >
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  {f.id === 'NEW' && waiting > 0 ? <i data-tone="biru">{waiting}</i> : null}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
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
                          <PhoneSquare status={status} />
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
                look={look}
                now={now}
                actions={actions}
                onStatus={(next) => setStatus(chosen, next)}
                onDeleted={() => {
                  setSelected(null);
                  onChanged();
                }}
              />
            ) : null}
          </div>
        </div>
      )}
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
