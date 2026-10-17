'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  bio: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
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

const MODES: { id: Mode; title: string; price: (monthly: string) => string; text: (monthly: string) => string; points: string[]; icon: string }[] = [
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
    price: () => '3 free leads',
    text: (monthly) => `For selling. Then ${monthly} a month, paid when you want.`,
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
type Reading = { id: string; label: string; icon: string; lines: string[] | null; result: IngestionResult | null };

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
  pastedTextMax,
  actions,
}: {
  page: { id: string; handle: string; displayName: string; mode: Mode } | null;
  /** Facts waiting in Review, oldest first: the newest are what a read just found. */
  facts: FoundFact[];
  monthlyPrice: string;
  pastedTextMax: number;
  actions: OnboardingActions;
}) {
  const [step, setStep] = useState(page ? 2 : 0);
  const [pageId, setPageId] = useState<string | null>(page?.id ?? null);
  const [handle, setHandle] = useState(page?.handle ?? '');
  const [name, setName] = useState(page?.displayName ?? '');
  const [mode, setMode] = useState<Mode>(page?.mode ?? 'BUSINESS');
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
  const settled = reading?.result !== null && reading?.result !== undefined;
  useEffect(() => {
    if (!readingId || settled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const result = await actions.fetchStatus(readingId);
        if (stopped) return;
        if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
          setReading((current) => (current && current.id === readingId ? { ...current, result } : current));
          if (result.status === 'SUCCEEDED' && result.extractedCount > 0) actions.refresh();
          return;
        }
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
  const found = done && result.status === 'SUCCEEDED' && foundCount > 0;
  const quiet = done && result.status === 'SUCCEEDED' && foundCount === 0;
  const failed = done && result.status === 'FAILED';
  // What this read found: the newest facts in the queue, once the refresh brings them.
  const justFound = found ? facts.slice(-foundCount) : [];
  const ask = justFound.find((fact) => fact.question);

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
                      <em>{m.price(monthlyPrice)}</em>
                    </b>
                    <p>{m.text(monthlyPrice)}</p>
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
              <button type="button" className={styles.go} onClick={() => setStep(2)}>
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
                <div className={styles.pbar} aria-hidden="true" />
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
        name={name}
        mode={mode}
        way={way}
        found={justFound}
        ask={ask ? { q: ask.question ?? '', a: ask.claim } : null}
        caption={
          [
            'Your address, live the moment you claim it.',
            business ? 'Business pages get a Shop tab and take numbers.' : 'Personal pages are free and about you.',
            'It reads a link, pasted text or a file.',
            found ? 'Ask it something. It answers from what it found.' : quiet ? 'Paste some text and it tries again.' : 'Facts appear as it reads. You check each one.',
          ][step] ?? ''
        }
      />
    </div>
  );
}

/** The page on a phone, taking shape as the owner types. Drawing only. */
function OnboardingArt({
  step,
  handle,
  handleFree,
  name,
  mode,
  way,
  found,
  ask,
  caption,
}: {
  step: number;
  handle: string;
  handleFree: boolean;
  name: string;
  mode: Mode;
  way: SourceWay;
  found: FoundFact[];
  ask: { q: string; a: string } | null;
  caption: string;
}) {
  const shown = name.trim() || 'Your name';
  const address = handle || 'yourname';
  const other: Mode = mode === 'BUSINESS' ? 'PERSONAL' : 'BUSINESS';
  const screen = (m: Mode, withQa: boolean) => (
    <div className={styles.scr}>
      <div className={styles.cov} />
      <div className={styles.pb}>
        <span className={styles.av}>{shown[0]?.toUpperCase()}</span>
        <p className={styles.nm}>{shown}</p>
        <p className={styles.hd}>curios.my/{address}</p>
        <span className={styles.tb}>
          <span>Links</span>
          <span>Ask</span>
          {m === 'BUSINESS' ? <span>Shop</span> : null}
        </span>
        {withQa && ask ? (
          <span className={styles.qa}>
            <span>{ask.q}</span>
            <span>{ask.a}</span>
          </span>
        ) : (
          <span className={styles.ghost}>
            <span />
            <span />
            <span />
          </span>
        )}
        <span className={styles.ask}>
          Ask {shown.split(' ')[0]} anything
          <i>
            <svg viewBox="0 0 24 24">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </i>
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.art} aria-hidden="true">
      <div className={styles.dots} />
      <div className={styles.blobs}>
        <span />
        <span />
        <span />
      </div>

      {step === 0 ? (
        <div className={styles.urlpill}>
          <span className={styles.lock}>
            <svg viewBox="0 0 24 24">
              <path d="M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          curios.my/<b>{handle}</b>
          <span className={styles.caret} />
          {handleFree ? (
            <span className={styles.yours}>
              <svg viewBox="0 0 24 24">
                <path d={ICON.check} />
              </svg>
              Yours
            </span>
          ) : null}
        </div>
      ) : null}

      {step === 2
        ? [
            { id: 'link', label: 'Link', icon: ICON.link },
            { id: 'text', label: 'Paste text', icon: ICON.text },
            { id: 'file', label: 'A file', icon: ICON.file },
            { id: 'bio', label: 'Bio', icon: ICON.bio },
          ].map((s) => (
            <span key={s.id} className={styles.sat} data-on={s.id === way || undefined}>
              <svg viewBox="0 0 24 24">
                <path d={s.icon} />
              </svg>
              <em>{s.label}</em>
            </span>
          ))
        : null}

      {step === 3 ? (
        <div className={styles.flist}>
          <div className={styles.fcount}>
            <b>{found.length}</b>
            <span>facts found</span>
          </div>
          {[...found]
            .reverse()
            .slice(0, 6)
            .map((fact) => (
              <div key={fact.id} className={styles.fcard}>
                <i className={styles.kind} data-kind={fact.category}>
                  {KIND_LABELS[fact.category]}
                </i>
                <span>{fact.claim}</span>
              </div>
            ))}
        </div>
      ) : null}

      <div className={styles.stage} data-step={step}>
        {step === 1 ? (
          <div className={styles.phone} data-behind="" data-mode={other}>
            {screen(other, false)}
            <span className={styles.tag}>{other === 'BUSINESS' ? 'Business' : 'Personal'}</span>
          </div>
        ) : null}
        <div className={styles.phone} data-front="" data-mode={mode}>
          {screen(mode, step === 3)}
          {step === 1 ? <span className={styles.tag}>{mode === 'BUSINESS' ? 'Business page' : 'Personal page'}</span> : null}
        </div>
      </div>
      <p className={styles.caption}>{caption}</p>
    </div>
  );
}

/** Supplies the real handlers. A Server Component may not pass functions. */
export function Onboarding(props: { page: { id: string; handle: string; displayName: string; mode: Mode } | null; facts: FoundFact[]; monthlyPrice: string; pastedTextMax: number }) {
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
