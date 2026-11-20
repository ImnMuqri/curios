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
import { useOwnView } from '../_ui/own-view.js';
import { PageHead } from '../_ui/page-head.js';
import { changeTone, StatStrip, type StatCard } from '../_ui/stat-strip.js';
import { useToast } from '../_ui/toast.js';
import { enquiryItemName, leadSummary } from './enquiry.js';
import { LeadDetail, LeadTag, STATUSES, type LeadActions, type LeadRow, type LeadStatus } from './lead-detail.js';
import styles from './leads.module.css';

type Filter = 'all' | LeadStatus;

const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUSES];

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
  const [statuses, setStatuses] = useState<Record<string, LeadStatus>>({});
  // Deleted here, and gone at once, before the server's read lands.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  // Sent on WhatsApp in this visit: their card keeps the first message, with the done line in place of Send.
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  // The lead last moved from its card, as the owner left it (see `kept`).
  const [snapshot, setSnapshot] = useState<OwnerLead | null>(null);
  const { say, note, fail, toast } = useToast();
  const screenRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const view = useOwnView({ screen: screenRef, detail: detailRef, row: (id) => `[data-lead-row="${CSS.escape(id)}"]`, firstRow: '[data-lead-row]' });
  const { open } = view;
  // A fresh read from the server is the truth again.
  useEffect(() => setStatuses({}), [leads]);

  const listed = leads.filter((lead) => !removed.has(lead.id));
  const statusOf = (lead: OwnerLead) => statuses[lead.id] ?? lead.status;
  const shown = listed.filter((lead) => (filter === 'all' || statusOf(lead) === filter) && leadMatches(lead, query));
  // The open lead is gone from the list altogether (another tab deleted it): back to the list, saying so.
  // A lead the owner moved from its card may leave the refreshed list (an old New one past the newest handled);
  // the last copy seen, with the status it was moved to, keeps the card in place, on every width.
  const kept = snapshot !== null && snapshot.id === chosenId && !removed.has(snapshot.id) ? snapshot : null;
  const gone = open && chosenId !== null && !listed.some((lead) => lead.id === chosenId) && kept === null;
  const pinned = view.holds(chosenId) ? (listed.find((lead) => lead.id === chosenId) ?? kept) : null;
  const chosen = gone ? null : (pinned ?? shown.find((lead) => lead.id === chosenId) ?? shown[0] ?? null);
  // One count everywhere: the chip says what the card says (and the sidebar badge, countNavBadges).
  const counts: Record<Filter, number | null> = { all: null, NEW: stats.waiting, CONTACTED: null, SOLD: null, CLOSED: null };

  useEffect(() => {
    if (!gone) return;
    view.gone();
    note('That lead is no longer in this list.');
  }, [gone, note]);

  // The save for each lead's status, in the order the owner chose them: a burst of arrow presses (New,
  // Contacted, Sold) sends its PATCHes one after another, so the server ends on the last. Only the latest
  // choice may change the screen, revert it or say anything; an earlier one settling late is dropped.
  const latest = useRef(new Map<string, number>());
  const queue = useRef(new Map<string, Promise<unknown>>());
  // What the server last confirmed for a lead mid-burst: where a failed last choice goes back to.
  const confirmed = useRef(new Map<string, LeadStatus>());

  /** Resolves true when this was still the latest choice and saved; false when a newer one took over; rejects when the latest failed. */
  async function setStatus(lead: OwnerLead, next: LeadStatus): Promise<boolean> {
    const id = lead.id;
    const mine = (latest.current.get(id) ?? 0) + 1;
    latest.current.set(id, mine);
    if (!confirmed.current.has(id)) confirmed.current.set(id, statusOf(lead));
    setChosenId(id);
    view.hold(id);
    setSnapshot({ ...lead, status: next });
    setStatuses((current) => ({ ...current, [id]: next }));
    const run = (queue.current.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => actions.setStatus(id, next));
    queue.current.set(id, run.catch(() => undefined));
    const current = () => latest.current.get(id) === mine;
    try {
      await run;
      confirmed.current.set(id, next);
    } catch (failure) {
      if (!current()) return false;
      const back = confirmed.current.get(id) ?? statusOf(lead);
      confirmed.current.delete(id);
      setSnapshot((now) => (now?.id === id ? { ...now, status: back } : now));
      setStatuses((now) => ({ ...now, [id]: back }));
      throw failure;
    }
    if (!current()) return false;
    confirmed.current.delete(id);
    onChanged();
    return true;
  }

  // A filter or search is changed from the list, so no lead holds the own view any more.
  function choose(next: Filter) {
    setFilter(next);
    view.leave();
  }

  function deleted(id: string) {
    setRemoved((current) => new Set(current).add(id));
    setChosenId(null);
    view.removed();
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
      lineTone: changeTone(stats.thisWeek - stats.lastWeek),
      // Exactly the week: seven Malaysian days, today last.
      spark: Array.from({ length: 7 }, (_, i) => stats.days[stats.days.length - 7 + i] ?? 0),
    },
    {
      id: 'sold',
      label: 'Became sales',
      value: stats.soldThisWeek,
      line: `${Math.round(rate * 100)}% of this week’s leads`,
      lineTone: rate > 0 ? 'up' : 'flat',
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
                      view.leave();
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
                    ) : paging.paged && filter === 'NEW' ? (
                      // A later page holds leads past New only: every new one is on the first.
                      <p className={styles.empty}>
                        <b>Not on this page</b>
                        <small>
                          These are older leads. The new ones are on the <Link href="/app/leads">newest page</Link>.
                        </small>
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
                              onClick={() => {
                                setChosenId(lead.id);
                                view.pick();
                              }}
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
                    <InboxBack noun="leads" onBack={() => view.back(chosen?.id ?? null)} />
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
                      fail={fail}
                      sent={sent.has(chosen.id)}
                      onSent={() => setSent((current) => new Set(current).add(chosen.id))}
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
