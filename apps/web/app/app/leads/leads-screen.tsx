'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatMalaysianPhone } from '@curios/core/phone';
import type { LeadStats, OwnerLead } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { EmptyPeek } from '../_ui/empty-peek.js';
import { InboxBack } from '../_ui/inbox-back.js';
import inbox from '../_ui/inbox.module.css';
import { PageHead } from '../_ui/page-head.js';
import { StatStrip, type StatCard } from '../_ui/stat-strip.js';
import { useToast } from '../_ui/toast.js';
import { enquiryItemName, leadSummary } from './enquiry.js';
import { LeadDetail, LeadTag, STATUSES, type LeadActions, type LeadRow, type LeadStatus } from './lead-detail.js';
import styles from './leads.module.css';

type Filter = 'all' | LeadStatus;

const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUSES];

/** Under this width a picked lead takes the screen as its own view (the frame's phone, inbox.module.css). */
const OWN_VIEW = '(max-width: 1100px)';

/** Whether a lead answers the search box: the number's digits, or what they are after (an enquiry's item and name too). */
export function leadMatches(lead: OwnerLead, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const wants = [lead.slots?.product, lead.slots?.date, lead.slots?.location, enquiryItemName(lead), lead.enquiry?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (digits.length >= 2 && lead.phone.replace(/\D/g, '').includes(digits)) || wants.includes(q);
}

/** The "Left a number this week" card's line: signed against last week, or the same. */
export function weekLine(thisWeek: number, lastWeek: number): string {
  const diff = thisWeek - lastWeek;
  if (diff === 0) return 'Same as last week';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} on last week`;
}

/** Of this week's leads, the share that became a sale: 0..1, and 0 (never NaN) with no leads this week. */
export function soldRate(soldThisWeek: number, thisWeek: number): number {
  return thisWeek > 0 ? Math.min(1, Math.max(0, soldThisWeek / thisWeek)) : 0;
}

/** Back to the top of the screen: whichever of its ancestors scrolls (the frame's sheet, or the page itself). */
function scrollToTop(el: HTMLElement | null) {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    if (node.scrollTop > 0) node.scrollTop = 0;
  }
  if (typeof window !== 'undefined' && window.scrollY > 0) window.scrollTo(0, 0);
}

/**
 * Every number a page has captured, newest first, on the calm board (Dash.html `leads`): the
 * header ("Inbox", Leads, one line), three stat cards (the new ones waiting, this week's numbers
 * with its spark, the ones that became sales with a rate bar), the filter chips and search, then
 * the numbers down the left and the chosen one on the right. The search narrows the fifty on this
 * page; the next fifty are a page further (`?before=`).
 *
 * On a phone a picked lead takes the screen as its own view (`data-open` on the split), with
 * "‹ All leads" back. It holds that lead by id until the owner goes back, even when a move takes
 * it out of the filter (Contacted under New); only a lead gone from the list altogether closes it.
 * Focus goes to the lead's heading on the way in and back to its row (or the first) on the way
 * out, the screen scrolled to the top each time.
 *
 * Presentational: `Leads` below supplies the real mutations. A status shows the moment it is
 * chosen and goes back if the save fails; the server is re-read after, for the figures.
 */
export function LeadsScreen({
  leads,
  paging = { older: null, paged: false },
  stats,
  displayName,
  language,
  publicUrl,
  now,
  keptMonths,
  actions,
  onChanged,
}: {
  leads: LeadRow[];
  /** `older`: the last lead shown, when there are more below it. `paged`: this is not the newest page. */
  paging?: { older: string | null; paged: boolean };
  stats: LeadStats;
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
  const [chosenId, setChosenId] = useState<string | null>(null);
  // The phone's own view: a lead picked from the list fills the screen.
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, LeadStatus>>({});
  // Deleted here, and gone at once, before the server's read lands.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const { say, fail, toast } = useToast();
  const screenRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  // After the own view opens or closes: 'detail', a row's id to land back on, or 'first' for the first row.
  const focusAfter = useRef<string | null>(null);
  // Asks for that focus move when the own view's state does not change (a delete on a wide screen).
  const [nudge, setNudge] = useState(0);
  // A fresh read from the server is the truth again.
  useEffect(() => setStatuses({}), [leads]);

  const listed = leads.filter((lead) => !removed.has(lead.id));
  const statusOf = (lead: OwnerLead) => statuses[lead.id] ?? lead.status;
  const shown = listed.filter((lead) => (filter === 'all' || statusOf(lead) === filter) && leadMatches(lead, query));
  // The open lead is gone from the list altogether (another tab deleted it): back to the list, saying so.
  const gone = open && chosenId !== null && !listed.some((lead) => lead.id === chosenId);
  const pinned = open ? (listed.find((lead) => lead.id === chosenId) ?? null) : null;
  const chosen = gone ? null : (pinned ?? shown.find((lead) => lead.id === chosenId) ?? shown[0] ?? null);
  // One count everywhere: the chip says what the card says (and the sidebar badge, countNavBadges).
  const counts: Record<Filter, number | null> = { all: null, NEW: stats.waiting, CONTACTED: null, SOLD: null, CLOSED: null };

  useEffect(() => {
    if (!gone) return;
    focusAfter.current = 'first';
    setOpen(false);
    say('That lead is no longer in this list.');
  }, [gone, say]);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    scrollToTop(screenRef.current);
    if (target === 'detail') {
      detailRef.current?.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
      return;
    }
    const root = screenRef.current;
    const row =
      (target !== 'first' ? root?.querySelector<HTMLElement>(`[data-lead-row="${CSS.escape(target)}"]`) : null) ??
      root?.querySelector<HTMLElement>('[data-lead-row]');
    row?.focus({ preventScroll: true });
  }, [open, nudge]);

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

  // A filter or search is changed from the list, so no lead holds the own view any more.
  function choose(next: Filter) {
    setFilter(next);
    setOpen(false);
  }

  function pick(id: string) {
    setChosenId(id);
    // Only where the own view shows: on a wide screen the detail is beside the list already.
    if (typeof window !== 'undefined' && window.matchMedia?.(OWN_VIEW).matches) {
      focusAfter.current = 'detail';
      setOpen(true);
    }
  }

  function back() {
    focusAfter.current = chosen?.id ?? 'first';
    setOpen(false);
  }

  function deleted(id: string) {
    setRemoved((current) => new Set(current).add(id));
    setChosenId(null);
    // The card it was in is gone: focus lands on the first row left, not the page's foot.
    focusAfter.current = 'first';
    setOpen(false);
    setNudge((n) => n + 1);
    say('Lead deleted.');
    onChanged();
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

  const rate = soldRate(stats.soldThisWeek, stats.thisWeek);
  const cards: StatCard[] = [
    {
      id: 'new',
      label: 'New, not contacted',
      value: stats.waiting,
      urgent: true,
      filter: 'NEW',
      go: (
        <>
          Reply to them <span aria-hidden="true">→</span>
        </>
      ),
    },
    {
      id: 'week',
      label: 'Left a number this week',
      value: stats.thisWeek,
      line: weekLine(stats.thisWeek, stats.lastWeek),
      // Exactly the week: seven Malaysian days, today last.
      spark: Array.from({ length: 7 }, (_, i) => stats.days[stats.days.length - 7 + i] ?? 0),
    },
    {
      id: 'sold',
      label: 'Became sales',
      value: stats.soldThisWeek,
      line: `${Math.round(rate * 100)}% of this week’s leads`,
      rate,
    },
  ];

  return (
    <>
      <div ref={screenRef} className={inbox.screen}>
        <PageHead kicker="Inbox" title="Leads" summary="People your page couldn’t answer, with what they asked." />

        <div className={inbox.body}>
          {leads.length === 0 ? (
            <EmptyPeek
              title="No numbers yet"
              line="When the chat can’t answer, it offers to pass the question to you. Numbers people leave show up here, with what they were asking."
            >
              <button type="button" className={styles.darkPill} onClick={() => void copyLink()}>
                {copied ? 'Copied' : 'Copy your link'}
              </button>
            </EmptyPeek>
          ) : (
            <>
              <StatStrip
                label="Leads at a glance"
                cards={cards}
                active={filter === 'NEW' ? 'NEW' : null}
                onFilter={(next) => choose((next as Filter | null) ?? 'all')}
              />

              <div className={inbox.fbar}>
                <div className={inbox.chips} role="group" aria-label="Show leads">
                  {FILTERS.map((f) => (
                    <button key={f.id} type="button" className={inbox.chip} aria-pressed={filter === f.id} onClick={() => choose(f.id)}>
                      {f.label}
                      {counts[f.id] ? <u>{counts[f.id]}</u> : null}
                    </button>
                  ))}
                </div>
                <label className={inbox.search}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={query}
                    placeholder="Search number or what they want"
                    aria-label="Search number or what they want"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setOpen(false);
                    }}
                  />
                </label>
              </div>

              <div className={inbox.split} data-open={open || undefined}>
                <div className={inbox.list}>
                  {shown.length === 0 ? (
                    query.trim() ? (
                      <p className={styles.empty}>
                        <b>No match</b>
                        <small>Try part of a number, or what they wanted.</small>
                      </p>
                    ) : (
                      <p className={styles.empty}>
                        <b>Nothing here yet</b>
                        {filter === 'NEW' ? <small>New numbers land here as people leave them.</small> : null}
                      </p>
                    )
                  ) : (
                    <ul className={styles.rows} aria-label="Leads">
                      {shown.map((lead, i) => {
                        const wants = leadSummary(lead);
                        return (
                          <li key={lead.id} className={styles.entry}>
                            <button
                              type="button"
                              className={`${inbox.li} ${styles.rowBtn}`}
                              aria-current={chosen?.id === lead.id}
                              data-lead-row={lead.id}
                              style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                              onClick={() => pick(lead.id)}
                            >
                              <span className={inbox.av} data-tone="red" aria-hidden="true">
                                #
                              </span>
                              <span className={inbox.liText}>
                                <b className={styles.phone}>{formatMalaysianPhone(lead.phone)}</b>
                                <small>
                                  {lead.enquiry ? <em className={styles.enquiryTag}>Enquiry</em> : null}
                                  {wants || 'Nothing picked out yet'}
                                </small>
                              </span>
                              <span className={inbox.liSide}>
                                <LeadTag status={statusOf(lead)} />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className={styles.foot}>
                    {paging.older || paging.paged ? (
                      <nav className={inbox.pager} aria-label="More leads">
                        {paging.paged ? <Link href="/app/leads">Newest</Link> : null}
                        {paging.older ? <Link href={`/app/leads?before=${encodeURIComponent(paging.older)}`}>Older leads</Link> : null}
                      </nav>
                    ) : null}
                    <p className={styles.kept}>Newest first · kept for {keptMonths} months</p>
                  </div>
                </div>
                {chosen ? (
                  <div ref={detailRef} className={inbox.det}>
                    <InboxBack noun="leads" onBack={back} />
                    <LeadDetail
                      key={chosen.id}
                      lead={chosen}
                      status={statusOf(chosen)}
                      displayName={displayName}
                      language={language}
                      now={now}
                      actions={actions}
                      onStatus={(next) => setStatus(chosen, next)}
                      say={say}
                      warn={fail}
                      onDeleted={() => deleted(chosen.id)}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
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
