'use client';

import { useEffect, useRef, useState } from 'react';
import { AnswerBubble } from '@curios/ui';
import { BentoPage } from '../_bento/BentoPage.js';
import { HANDLE_TYPED_EVENT } from '../../lib/wanted-handle.js';
import { DEMO_PAGE, DEMO_QA } from './demo.js';
import { Device } from './Device.js';
import styles from './hero.module.css';

const THINK_MS = 650;
/** How long each suggested question shows in the input before the next, the same pace the old ask bar kept. */
const CYCLE_MS = 4000;
const WORD_MS = 55;

/**
 * The demo shop's page, inside a phone. BentoPage and AskBar are the real
 * components a visitor sees on curios.my/:handle, so this cannot drift from
 * the product. Tapping the bar does what it does there -- asks -- except the
 * answer comes from DEMO_QA instead of the model: typing dots, then the
 * answer streaming in word by word, the way the real chat streams.
 *
 * Typing into the hero's curios.my/ field changes the address on this page
 * as you type (HANDLE_TYPED_EVENT), so the visitor sees their own link.
 *
 * SWAP: to show a live page instead, replace the onOpen handler with the real
 * `Ask` component from app/[handle]/ask.tsx pointed at a seeded page. That
 * costs inference on every landing visit, which is why it is not the default.
 */
export function HeroDemo({ label, hint }: { label: string; hint: string }) {
  // Opens with the first question already answered, so the proof is visible
  // before anyone taps. The cue stays until they ask one of their own.
  const [asked, setAsked] = useState<{ q: string; a: string }>(DEMO_QA[0]!);
  const [shown, setShown] = useState(DEMO_QA[0]!.a);
  const [thinking, setThinking] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [round, setRound] = useState(0);
  const [handle, setHandle] = useState(DEMO_PAGE.handle);
  const [typed, setTyped] = useState(false);
  // Which sample question the input offers next. Tapping sends it.
  const [next, setNext] = useState(1 % DEMO_QA.length);
  const screen = useRef<HTMLDivElement>(null);

  // The input offers the sample questions in turn, like a chat suggesting what to ask. Under reduced motion it holds still.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setNext((i) => (i + 1) % DEMO_QA.length), CYCLE_MS);
    return () => clearInterval(timer);
  }, []);

  // The visitor's own address, live, from the claim field beside the phone.
  useEffect(() => {
    const onTyped = (event: Event) => {
      const typed = (event as CustomEvent<string>).detail;
      setHandle(typed || DEMO_PAGE.handle);
      setTyped(Boolean(typed));
      // The address sits at the top of the page; bring it into view so they see it change.
      screen.current?.scrollTo?.({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    window.addEventListener(HANDLE_TYPED_EVENT, onTyped);
    return () => window.removeEventListener(HANDLE_TYPED_EVENT, onTyped);
  }, []);

  // Typing dots, then the answer a word at a time. Reduced motion: all at once.
  useEffect(() => {
    if (round === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setThinking(false);
      setShown(asked.a);
      return;
    }
    const words = asked.a.split(' ');
    const timers: ReturnType<typeof setTimeout>[] = [];
    setThinking(true);
    setShown('');
    timers.push(
      setTimeout(() => {
        setThinking(false);
        words.forEach((_, i) => {
          timers.push(setTimeout(() => setShown(words.slice(0, i + 1).join(' ')), i * WORD_MS));
        });
      }, THINK_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [round, asked]);

  useEffect(() => {
    // The phone opens at the top, cover and logo first, like a page someone just
    // landed on. Only once a question is asked does it follow the newest line --
    // inside the phone's own scroll box, never scrollIntoView, which would also
    // move the landing page itself.
    if (round === 0) return;
    const box = screen.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [shown, thinking, round]);

  // Sends the question the input is showing, then offers the one after it.
  function ask() {
    setAsked(DEMO_QA[next]!);
    setTapped(true);
    setRound((r) => r + 1);
    setNext((i) => (i + 1) % DEMO_QA.length);
  }

  return (
    <div className={styles.phone} data-hero-demo data-asked={tapped ? 'true' : 'false'} data-typed={typed ? 'true' : 'false'} role="group" aria-label={label}>
      <Device time="3:15" chrome="browser" url={`curios.my/${handle}`}>
      <div ref={screen} className={styles.screen}>
        <BentoPage {...DEMO_PAGE} handle={handle}>
          <div className={styles.thread} key={round}>
            <p className={styles.asked}>{asked.q}</p>
            {thinking ? (
              <p className={styles.typing} role="status" aria-label="Typing">
                <span />
                <span />
                <span />
              </p>
            ) : (
              <AnswerBubble text={shown} />
            )}
          </div>
          {/* Drawn as chat mode's own input -- a white pill, a round send button -- with the next question
              already typed in it. One tap sends it, so the demo is a chat, not a bar to open one. */}
          <div className={styles.composerBar}>
          <button type="button" className={styles.composer} onClick={ask} aria-label={`Ask: ${DEMO_QA[next]!.q}`}>
            <span className={styles.composerText}>{DEMO_QA[next]!.q}</span>
            <span className={styles.send} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </span>
          </button>
          </div>
        </BentoPage>
      </div>
      </Device>
      <p className={styles.hint} aria-hidden="true">
        {hint}
      </p>
    </div>
  );
}
