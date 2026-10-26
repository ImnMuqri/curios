'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api.js';
import { loginWalledSite } from '../../../lib/social-links.js';
import { forgetWantedHandle, readWantedHandle } from '../../../lib/wanted-handle.js';
import { Wordmark } from '../../_landing/Wordmark.js';
import { KIND_LABELS } from '../knowledge/facts-tab.js';
import { checkSource, FILE_ACCEPT, fileSize, ingestSource, type IngestionResult, type Source, type SourceWay } from './source-input.js';
import styles from './onboarding.module.css';

export type Mode = 'PERSONAL' | 'BUSINESS';
export type HandleStatus = 'available' | 'invalid' | 'reserved' | 'taken';

/** A fact found while reading, for the chips and the phone. */
export interface FoundFact {
  id: string;
  category: keyof typeof KIND_LABELS;
  claim: string;
  question: string | null;
}

export interface OnboardingActions {
  checkHandle: (handle: string) => Promise<HandleStatus>;
  claim: (input: { handle: string; displayName: string; mode: Mode }) => Promise<{ pageId: string }>;
  ingest: (source: Source) => Promise<{ ingestionId: string; truncated?: boolean }>;
  fetchStatus: (id: string) => Promise<IngestionResult>;
  /** Re-reads the server's side, so the facts just found arrive as props. */
  refresh: () => void;
  navigate: (url: string) => void;
}

const ICON = {
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  text: 'M6 3h9l4 4v14H6zM9 12h7M9 16h5',
  file: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  shop: 'M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9l2-5h12l2 5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

const WAYS: { id: SourceWay; label: string; icon: string }[] = [
  { id: 'link', label: 'Link', icon: ICON.link },
  { id: 'text', label: 'Paste text', icon: ICON.text },
  { id: 'file', label: 'A file', icon: ICON.file },
];

/** The plan in force, as the modes quote it: "RM49" and the free leads. */
type Terms = { monthly: string; freeLeads: number };

const MODES: { id: Mode; title: string; price: (terms: Terms) => string; text: (terms: Terms) => string; points: string[]; icon: string }[] = [
  {
    id: 'PERSONAL',
    title: 'Personal',
    price: () => 'Free',
    text: () => 'A page about you. For freelancers, job seekers and creators.',
    points: ['Answers questions about you and your work', 'Hidden from search engines unless you choose', 'Free, for good'],
    icon: ICON.person,
  },
  {
    id: 'BUSINESS',
    title: 'Business',
    price: ({ freeLeads }) => `${freeLeads} free ${freeLeads === 1 ? 'lead' : 'leads'}`,
    text: ({ monthly }) => `For selling. Then ${monthly} a month, paid when you want.`,
    points: ['Takes numbers when the chat can’t answer', 'A shop with orders paid to your QR', 'FAQ pages people find on Google'],
    icon: ICON.shop,
  },
];

/** The address check's words, as the board writes them. */
function availability(status: HandleStatus | 'empty' | 'checking' | 'error', handle: string): { text: string; hint: string } {
  switch (status) {
    case 'empty':
      return { text: 'Type one', hint: 'Letters and numbers, no spaces.' };
    case 'checking':
      return { text: 'Checking…', hint: 'This becomes the link you share everywhere.' };
    case 'invalid':
      return { text: 'Not quite', hint: 'Use 3 to 30 lowercase letters or numbers, no spaces or symbols.' };
    case 'reserved':
    case 'taken':
      return { text: 'Taken', hint: `Someone has that one. Try ${handle}my or ${handle}2.` };
    case 'error':
      return { text: 'Not checked', hint: 'We could not check it just now. Continue, and we will check as you claim it.' };
    case 'available':
      return { text: 'Yours', hint: 'This becomes the link you share everywhere.' };
  }
}

/** Where a read is: going, done with facts, done with none, or failed. */
type Reading = {
  id: string;
  label: string;
  icon: string;
  lines: string[] | null;
  /** The last word on it while it reads: how far, and how many facts so far. */
  live: IngestionResult | null;
  /** Its final word, once it has finished. */
  result: IngestionResult | null;
};

/**
 * Onboarding, from the design handoff's Onboarding board. Four steps: claim
 * the address (with a live check), say what the page is for, give it
 * something to read, and watch it read. The page is claimed when the owner
 * reads a source or skips, so Back works freely until then; an owner who
 * already has a page starts at the third step.
 */
export function OnboardingFlow({
  page,
  facts,
  monthlyPrice,
  freeLeads,
  pastedTextMax,
  actions,
}: {
  page: { id: string; handle: string; displayName: string; mode: Mode } | null;
  /** Facts waiting in Review, oldest first: the newest are what a read just found. */
  facts: FoundFact[];
  monthlyPrice: string;
  /** The free leads in force (`Settings.freeLeads`). */
  freeLeads: number;
  pastedTextMax: number;
  actions: OnboardingActions;
}) {
  const [step, setStep] = useState(page ? 2 : 0);
  const [pageId, setPageId] = useState<string | null>(page?.id ?? null);
  const [handle, setHandle] = useState(page?.handle ?? '');
  const [name, setName] = useState(page?.displayName ?? '');
  // Nothing chosen until the owner chooses: business can never go back to personal, so a
  // default would be a one-way door for anyone who just presses Continue (README, Tiers).
  const [mode, setMode] = useState<Mode | null>(page?.mode ?? null);
  const [status, setStatus] = useState<HandleStatus | 'empty' | 'checking' | 'error'>(page ? 'available' : 'empty');
  const [way, setWay] = useState<SourceWay>('link');
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [claimError, setClaimError] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const checked = useRef(0);
  const business = mode === 'BUSINESS';

  // A handle chosen on the landing page before signing up.
  useEffect(() => {
    if (page) return;
    const wanted = readWantedHandle();
    if (wanted) setHandle((current) => current || wanted);
  }, [page]);

  // The live check, a moment after typing stops.
  useEffect(() => {
    if (page) return;
    if (!handle) {
      setStatus('empty');
      return;
    }
    setStatus('checking');
    const ticket = ++checked.current;
    const timer = setTimeout(() => {
      actions
        .checkHandle(handle)
        .then((next) => {
          if (ticket === checked.current) setStatus(next);
        })
        .catch(() => {
          if (ticket === checked.current) setStatus('error');
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [handle, page, actions]);

  // Asking how the read is going until it finishes.
  const readingId = reading?.id;
  const seenCount = useRef(0);
  useEffect(() => {
    seenCount.current = 0;
  }, [readingId]);
  const settled = reading?.result !== null && reading?.result !== undefined;
  useEffect(() => {
    if (!readingId || settled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const result = await actions.fetchStatus(readingId);
        if (stopped) return;
        const over = result.status === 'SUCCEEDED' || result.status === 'FAILED';
        // Facts are written as they are found: each time the count rises, the
        // server is asked again so the new ones arrive, one by one.
        if (result.extractedCount > seenCount.current) {
          seenCount.current = result.extractedCount;
          actions.refresh();
        }
        setReading((current) => (current && current.id === readingId ? { ...current, live: result, result: over ? result : null } : current));
        if (over) return;
      } catch {
        // Tried again on the next tick.
      }
      if (!stopped) timer = setTimeout(() => void ask(), 2000);
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [readingId, settled, actions]);

  /** Claims the page once, the first time something needs it. */
  async function ensurePage(): Promise<string | null> {
    if (pageId) return pageId;
    if (!mode) {
      setStep(1);
      return null;
    }
    try {
      const claimed = await actions.claim({ handle, displayName: name.trim(), mode });
      forgetWantedHandle();
      setPageId(claimed.pageId);
      return claimed.pageId;
    } catch (failure) {
      // Taken since the check, most likely: back to the address, saying why.
      setClaimError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setStep(0);
      return null;
    }
  }

  async function read(event?: FormEvent) {
    event?.preventDefault();
    setError('');
    const problem = checkSource(way, { sourceUrl: link, pastedText: text, file }, pastedTextMax);
    if (problem) {
      setError('paste' in problem ? problem.paste : problem.error);
      return;
    }
    setBusy(true);
    const id = await ensurePage();
    if (!id) {
      setBusy(false);
      return;
    }
    try {
      const source: Source = way === 'text' ? { pageId: id, pastedText: text } : way === 'file' && file ? { pageId: id, file } : { pageId: id, sourceUrl: link.trim() };
      const started = await actions.ingest(source);
      setReading({
        id: started.ingestionId,
        label: way === 'link' ? link.trim() : way === 'file' && file ? file.name : 'What you pasted',
        icon: way === 'link' ? ICON.web : way === 'file' ? ICON.file : ICON.text,
        lines:
          way === 'text'
            ? text
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 6)
            : null,
        live: null,
        result: null,
      });
      setStep(3);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    const id = await ensurePage();
    if (id) actions.navigate('/app/curios');
    else setBusy(false);
  }

  function again(next: SourceWay) {
    setReading(null);
    setError('');
    setWay(next);
    setLink('');
    setText('');
    setFile(null);
    setStep(2);
  }

  const avail = availability(status, handle);
  const canContinue = status === 'available' || status === 'error';
  const walled = way === 'link' && loginWalledSite(link) !== null;
  const canRead = (way === 'link' ? link.trim().length > 3 : way === 'text' ? text.trim().length > 20 : file !== null) && !walled;
  const result = reading?.result ?? null;
  const done = result !== null;
  const foundCount = result?.status === 'SUCCEEDED' ? result.extractedCount : 0;
  const progress = reading?.live?.progress ?? 0;
  const found = done && result.status === 'SUCCEEDED' && foundCount > 0;
  const quiet = done && result.status === 'SUCCEEDED' && foundCount === 0;
  const failed = done && result.status === 'FAILED';
  // What this read found: the newest facts in the queue, once the refresh brings them.
  const justFound = found ? facts.slice(-foundCount) : [];

  return (
    <div className={styles.ob}>
      <div className={styles.form}>
        <div className={styles.top}>
          <a href="/app/curios" aria-label="Curios">
            <Wordmark />
          </a>
          <span className={styles.steps}>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} data-on={i <= step || undefined} data-now={i === step || undefined} aria-hidden="true" />
            ))}
            <span>Step {step + 1} of 4</span>
          </span>
        </div>

        {step === 0 ? (
          <form
            key="claim"
            className={styles.body}
            onSubmit={(event) => {
              event.preventDefault();
              if (canContinue && name.trim()) {
                setClaimError('');
                setStep(1);
              }
            }}
          >
            <h1 className={styles.h}>Claim your page</h1>
            <p className={styles.lede}>Pick your address. You can change how it looks later, not the address.</p>
            <label className={styles.lab} htmlFor="ob-handle">
              Your address
            </label>
            <span className={styles.addr}>
              <span>curios.my/</span>
              <input
                id="ob-handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/\s+/g, ''))}
                maxLength={30}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="ob-handle-hint"
              />
              <span className={styles.avail} data-state={status} role="status">
                {status === 'available' ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={ICON.check} />
                  </svg>
                ) : null}
                {avail.text}
              </span>
            </span>
            <p className={styles.hint} id="ob-handle-hint">
              {avail.hint}
            </p>
            <label className={styles.lab} htmlFor="ob-name">
              Name on the page
            </label>
            <span className={styles.txt}>
              <input id="ob-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Your name or your business" autoComplete="name" />
            </span>
            {claimError ? (
              <p className={styles.error} role="alert">
                {claimError}
              </p>
            ) : null}
            <div className={styles.foot}>
              <button type="submit" className={styles.go} disabled={!(canContinue && name.trim())}>
                Continue
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={ICON.arrow} />
                </svg>
              </button>
            </div>
          </form>
        ) : null}

        {step === 1 ? (
          <div key="mode" className={styles.body}>
            <h1 className={styles.h}>What is this page for?</h1>
            <p className={styles.lede}>You can switch a personal page to business later. Not the other way round.</p>
            <div className={styles.modes} role="radiogroup" aria-label="What this page is for">
              {MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} data-mode={m.id} className={styles.mode} onClick={() => setMode(m.id)}>
                  <span className={styles.mi} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d={m.icon} />
                    </svg>
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <b>
                      {m.title}
                      <em>{m.price({ monthly: monthlyPrice, freeLeads })}</em>
                    </b>
                    <p>{m.text({ monthly: monthlyPrice, freeLeads })}</p>
                    <ul>
                      {m.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </span>
                  <span className={styles.rad} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d={ICON.check} />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
            <div className={styles.foot}>
              <button type="button" className={styles.back} onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className={styles.go} disabled={mode === null} onClick={() => setStep(2)}>
                Continue
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={ICON.arrow} />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <form key="teach" className={styles.body} onSubmit={(event) => void read(event)}>
            <h1 className={styles.h}>{business ? 'Teach it about your business' : 'Teach it about you'}</h1>
            <p className={styles.lede}>Give it something to read. The facts it finds wait for you to check, so nothing goes live by surprise.</p>
            <div className={styles.ways} role="group" aria-label="How to add it">
              {WAYS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={way === w.id}
                  onClick={() => {
                    setWay(w.id);
                    setError('');
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={w.icon} />
                  </svg>
                  <span>{w.label}</span>
                </button>
              ))}
            </div>
            {way === 'link' ? (
              <>
                <label className={styles.lab} htmlFor="ob-link">
                  {business ? 'Your website address' : 'A link about you'}
                </label>
                <span className={styles.txt}>
                  <input id="ob-link" value={link} onChange={(event) => setLink(event.target.value.trim())} placeholder="your-site.com" inputMode="url" autoComplete="off" />
                </span>
                <p className={styles.hint}>{business ? 'Your website, online shop, menu or any page about the business.' : 'Your site, Linktree or portfolio.'}</p>
                {walled ? <p className={styles.note}>Instagram, TikTok, Facebook and LinkedIn don’t let us read profiles. Paste your bio or captions from there instead.</p> : null}
              </>
            ) : way === 'text' ? (
              <>
                <label className={styles.lab} htmlFor="ob-text">
                  {business ? 'About your business' : 'About you'}
                </label>
                <textarea
                  id="ob-text"
                  className={styles.paste}
                  value={text}
                  maxLength={pastedTextMax}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="A bio, captions, an About section. Whatever says it best."
                />
                <p className={styles.hint}>
                  {text.length.toLocaleString('en-US')} of {pastedTextMax.toLocaleString('en-US')} characters
                </p>
              </>
            ) : (
              <>
                <span className={styles.lab}>A file</span>
                <label
                  className={styles.drop}
                  data-dragging={dragging || undefined}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    const dropped = event.dataTransfer.files[0];
                    if (dropped) setFile(dropped);
                  }}
                >
                  <input
                    type="file"
                    accept={FILE_ACCEPT}
                    aria-label="A file to read"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];
                      if (chosen) setFile(chosen);
                    }}
                  />
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={ICON.file} />
                  </svg>
                  <b>{file ? file.name : 'Choose a file, or drop it here'}</b>
                  <small>
                    {file
                      ? `${fileSize(file.size)}. Click to choose a different one.`
                      : `${business ? 'A menu, a price list, a brochure.' : 'Your resume, a portfolio, a bio.'} PDF, Word or text, up to 5 MB.`}
                  </small>
                </label>
              </>
            )}
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <div className={styles.foot}>
              {pageId === null ? (
                <button type="button" className={styles.back} onClick={() => setStep(1)}>
                  Back
                </button>
              ) : null}
              <button type="submit" className={styles.go} disabled={!canRead || busy}>
                {busy ? 'Starting…' : way === 'link' ? (business ? 'Read my website' : 'Read this link') : way === 'text' ? 'Read what I pasted' : 'Read this file'}
              </button>
              <button type="button" className={styles.skip} disabled={busy} onClick={() => void skip()}>
                Skip for now
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 && reading ? (
          <div key="reading" className={styles.body}>
            <h1 className={styles.h}>{found ? 'Done reading' : quiet ? 'That one was quiet' : failed ? 'That didn’t work' : 'Reading it now…'}</h1>
            <p className={styles.lede} role="status">
              {found
                ? 'Here is what it picked out.'
                : quiet
                  ? 'Some pages hide their text from us.'
                  : failed
                    ? result.error ?? 'We could not read it.'
                    : 'This usually takes under a minute. You can leave: the facts will wait in Review.'}
            </p>
            {!done ? (
              <>
                <div className={styles.reader}>
                  <p className={styles.src}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={reading.icon} />
                    </svg>
                    {reading.label}
                  </p>
                  {reading.lines && reading.lines.length > 0
                    ? reading.lines.map((line, i) => (
                        <p key={i} className={styles.rl}>
                          {line}
                        </p>
                      ))
                    : Array.from({ length: 6 }, (_, i) => <p key={i} className={styles.rl} data-skel="" aria-hidden="true" />)}
                </div>
                <div
                  className={styles.pbar}
                  role="progressbar"
                  aria-label="How far it has read"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <i style={{ width: `${Math.max(4, progress)}%` }} />
                </div>
              </>
            ) : null}
            {justFound.length > 0 ? (
              <div className={styles.found}>
                {justFound.map((fact) => (
                  <span key={fact.id} className={styles.fchip}>
                    <i className={styles.kind} data-kind={fact.category}>
                      {KIND_LABELS[fact.category]}
                    </i>
                    <span>{fact.claim}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {found ? (
              <>
                <div className={styles.res}>
                  <span className={styles.ri} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d={ICON.check} />
                    </svg>
                  </span>
                  <span>
                    <b>Found {foundCount === 1 ? '1 fact' : `${foundCount} facts`}</b>
                    <span>They are waiting in Review. Nothing goes live until you accept each one.</span>
                  </span>
                </div>
                <div className={styles.foot}>
                  <a className={styles.go} href="/app/review">
                    Review them
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d={ICON.arrow} />
                    </svg>
                  </a>
                  <button type="button" className={styles.back} onClick={() => again('link')}>
                    Add another source
                  </button>
                </div>
              </>
            ) : null}
            {quiet ? (
              <>
                <div className={styles.res} data-tone="amber">
                  <span className={styles.ri} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 8v5M12 16.5h.01" />
                    </svg>
                  </span>
                  <span>
                    <b>Nothing to use yet</b>
                    <span>That page didn’t let us read much. Paste a few sentences about what you sell, your prices or your hours instead.</span>
                  </span>
                </div>
                <div className={styles.foot}>
                  <button type="button" className={styles.go} onClick={() => again('text')}>
                    Paste text instead
                  </button>
                  <a className={styles.skip} href="/app/curios">
                    Skip for now
                  </a>
                </div>
              </>
            ) : null}
            {failed ? (
              <div className={styles.foot}>
                <button type="button" className={styles.go} onClick={() => again('link')}>
                  Try a different source
                </button>
                <a className={styles.skip} href="/app/curios">
                  Skip for now
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <OnboardingArt
        step={step}
        handle={handle}
        handleFree={status === 'available'}
        mode={mode}
        outcome={found ? 'found' : done ? 'none' : null}
        foundCount={foundCount}
        found={justFound.slice(0, 3)}
      />
    </div>
  );
}

type Pose = 'claim' | 'business' | 'personal' | 'read' | 'scan' | 'found' | 'none';

/** The panel's two lines, one pair per pose (Onboarding.dc.html, paT and paS). */
function panelCaption(pose: Pose, handleFree: boolean, foundCount: number): [string, string] {
  switch (pose) {
    case 'claim':
      return [handleFree ? 'It’s yours' : 'Pick an address', 'Your page goes live at this address the moment you claim it.'];
    case 'business':
      return ['A page that sells', 'It answers customers, takes their numbers and runs your shop.'];
    case 'personal':
      return ['A page about you', 'It answers questions about you and your work.'];
    case 'read':
      return ['Give it something to read', 'Everything it learns waits for you to check first.'];
    case 'scan':
      return ['Reading it now', 'Picking out prices, hours and what you offer.'];
    case 'found':
      return [`Found ${foundCount} facts`, 'They wait in Review until you accept them.'];
    default:
      // Also what a failed read shows (DEVIATIONS row 89); the form says what went wrong.
      return ['Nothing to read there', 'Try pasting a few lines instead.'];
  }
}

/** Peek's body, the same in every pose; the eyes look to (look.x, look.y) and the mouth is the pose's. */
function PeekBody({ clipId, look, mouth }: { clipId: string; look?: { x: number; y: number }; mouth?: 'smile' | 'flat' | 'happy' }) {
  return (
    <g className={styles.bob}>
      <g clipPath={`url(#${clipId})`}>
        <rect x="20" y="30" width="120" height="110" fill="var(--peek-shade)" />
        <ellipse cx="73" cy="76" rx="54" ry="48" fill="var(--peek-body)" />
      </g>
      <ellipse cx="55" cy="54" rx="9" ry="5" fill="var(--peek-shine)" transform="rotate(-30 55 54)" />
      {mouth === 'happy' ? (
        <path d="M55 86q11-13 22 0M84 86q11-13 22 0" fill="none" stroke="var(--card)" strokeWidth="5.5" strokeLinecap="round" />
      ) : look ? (
        <g className={styles.eyes}>
          <ellipse cx="66" cy="82" rx="11.5" ry="13.5" fill="var(--card)" />
          <ellipse cx="95" cy="82" rx="11.5" ry="13.5" fill="var(--card)" />
          <circle cx={look.x} cy={look.y} r="6.6" fill="var(--ink)" />
          <circle cx={look.x + 29} cy={look.y} r="6.6" fill="var(--ink)" />
          <circle cx={look.x + 2.2} cy={look.y - 3} r="2.1" fill="var(--card)" />
          <circle cx={look.x + 31.2} cy={look.y - 3} r="2.1" fill="var(--card)" />
        </g>
      ) : null}
      {mouth === 'smile' ? <path d="M75 104q5.5 4.5 11 0" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /> : null}
      {mouth === 'flat' ? <path d="M76 105h9" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" /> : null}
      {mouth === 'happy' ? <path d="M72 102q8.5 9 17 0z" fill="var(--ink)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" /> : null}
    </g>
  );
}

function Hand({ cx, cy, className }: { cx: number; cy: number; className?: string }) {
  return (
    <g className={className}>
      <circle cx={cx} cy={cy} r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
    </g>
  );
}

function Paper() {
  return (
    <g className={styles.paper}>
      <g transform="rotate(-5 80 124)">
        <rect x="50" y="106" width="60" height="40" rx="5" fill="var(--card)" stroke="var(--ink)" strokeWidth="2" />
        <rect x="58" y="115" width="36" height="4" rx="2" fill="var(--ghost-line)" />
        <rect x="58" y="123" width="44" height="4" rx="2" fill="var(--ghost-line)" />
        <rect x="58" y="131" width="28" height="4" rx="2" fill="var(--ghost-line)" />
      </g>
    </g>
  );
}

/**
 * The panel beside the form: Peek, full-body, one pose per step, from the
 * Onboarding board ("onboarding panel: Peek"). It does not stream facts while
 * the read runs and has no phone preview (owner answer 8). Decoration only.
 */
function OnboardingArt({
  step,
  handle,
  handleFree,
  mode,
  outcome,
  foundCount,
  found,
}: {
  step: number;
  handle: string;
  handleFree: boolean;
  /** Null until the owner picks one; the panel stays on the address until then. */
  mode: Mode | null;
  /** How a finished read ended: with facts, or with nothing (quiet or failed). Null while it reads. */
  outcome: 'found' | 'none' | null;
  foundCount: number;
  /** The first three facts it found, shown once the read is done. */
  found: FoundFact[];
}) {
  const clipId = `ob-clip-${useId().replace(/:/g, '')}`;
  const pose: Pose =
    step === 0 ? 'claim' : step === 1 ? (mode === 'BUSINESS' ? 'business' : mode === 'PERSONAL' ? 'personal' : 'claim') : step === 2 ? 'read' : outcome === 'found' ? 'found' : outcome === 'none' ? 'none' : 'scan';
  const [title, line] = panelCaption(pose, handleFree, foundCount);

  return (
    <aside className={styles.art} aria-hidden="true" data-onboarding-panel="">
      <div className={styles.pa}>
        <div className={styles.pstage}>
          {pose === 'claim' ? (
            <div className={styles.signw}>
              <span className={styles.sign}>
                <small>curios.my/</small>
                <b>{handle || 'yourname'}</b>
                {handleFree ? (
                  <i className={styles.tk} data-peek-tick="">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </i>
                ) : null}
                <em className={styles.hl} />
                <em className={styles.hr} />
              </span>
            </div>
          ) : null}
          {pose === 'found' ? (
            <div className={styles.pops}>
              {found.map((fact, i) => (
                <span key={fact.id} data-peek-fact="" style={{ animationDelay: `${i * 250}ms` }}>
                  <i className={styles.kind} data-kind={fact.category}>
                    {KIND_LABELS[fact.category]}
                  </i>
                  <b>{fact.claim}</b>
                </span>
              ))}
            </div>
          ) : null}
          <svg className={styles.svg} viewBox={pose === 'claim' ? '-14 26 188 124' : '-14 -6 188 156'} data-pose={pose}>
            <defs>
              <clipPath id={clipId}>
                <ellipse cx="80" cy="84" rx="54" ry="49" />
              </clipPath>
            </defs>
            <ellipse cx="80" cy="143" rx="44" ry="4.5" className={styles.shadow} />
            <ellipse cx="63" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
            <ellipse cx="97" cy="132" rx="13" ry="8" fill="var(--peek-foot)" />
            {pose === 'claim' ? <PeekBody clipId={clipId} look={{ x: 67, y: 81 }} mouth="smile" /> : null}
            {pose === 'business' ? (
              <>
                <PeekBody clipId={clipId} look={{ x: 71, y: 86 }} mouth="smile" />
                <g className={styles.bagg}>
                  <path d="M127 98q0-12 9-12t9 12" fill="none" stroke="var(--ink)" strokeWidth="2.4" />
                  <rect x="118" y="96" width="36" height="34" rx="6" fill="var(--kuning)" stroke="var(--ink)" strokeWidth="2" />
                  <rect x="118" y="104" width="36" height="5" fill="var(--peek-bag-shade)" />
                  <circle cx="136" cy="88" r="9.5" fill="var(--peek-hand)" stroke="var(--peek-edge)" strokeWidth="1.5" />
                </g>
                <Hand cx={20} cy={104} />
              </>
            ) : null}
            {pose === 'personal' ? (
              <>
                <PeekBody clipId={clipId} look={{ x: 67, y: 85 }} mouth="smile" />
                <Hand cx={20} cy={104} />
                <Hand cx={141} cy={62} className={styles.wave} />
              </>
            ) : null}
            {pose === 'read' || pose === 'scan' ? (
              <>
                <PeekBody clipId={clipId} look={{ x: 67, y: pose === 'read' ? 89 : 90 }} />
                <Paper />
                {pose === 'scan' ? (
                  <rect className={styles.scan} data-peek-scan="" x="49" y="112" width="62" height="3" rx="1.5" fill="var(--peek-body)" transform="rotate(-5 80 124)" />
                ) : null}
                <Hand cx={50} cy={124} />
                <Hand cx={111} cy={120} />
              </>
            ) : null}
            {pose === 'found' ? (
              <>
                <PeekBody clipId={clipId} mouth="happy" />
                <Hand cx={16} cy={78} className={styles.cheer} />
                <Hand cx={144} cy={78} className={styles.cheer2} />
              </>
            ) : null}
            {pose === 'none' ? (
              <>
                <PeekBody clipId={clipId} look={{ x: 62, y: 85 }} mouth="flat" />
                <Hand cx={18} cy={112} />
                <Hand cx={142} cy={112} />
              </>
            ) : null}
          </svg>
        </div>
        <p className={styles.cap}>
          <b>{title}</b>
          <span>{line}</span>
        </p>
      </div>
    </aside>
  );
}

/** Supplies the real handlers. A Server Component may not pass functions. */
export function Onboarding(props: { page: { id: string; handle: string; displayName: string; mode: Mode } | null; facts: FoundFact[]; monthlyPrice: string; freeLeads: number; pastedTextMax: number }) {
  const router = useRouter();
  const [actions] = useState<OnboardingActions>(() => ({
    checkHandle: async (handle) => (await apiFetch<{ status: HandleStatus }>(`/pages/handle-check?handle=${encodeURIComponent(handle)}`)).status,
    claim: (input) => apiFetch<{ pageId: string }>('/pages', { method: 'POST', body: JSON.stringify(input) }),
    ingest: ingestSource,
    fetchStatus: (id) => apiFetch<IngestionResult>(`/ingest/${id}`),
    refresh: () => router.refresh(),
    navigate: (url) => window.location.assign(url),
  }));
  return <OnboardingFlow {...props} actions={actions} />;
}
