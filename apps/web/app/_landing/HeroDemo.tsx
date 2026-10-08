'use client';

import { useEffect, useRef, useState } from 'react';
import { AnswerBubble, AskBar } from '@curios/ui';
import { BentoPage } from '../_bento/BentoPage.js';
import { HANDLE_TYPED_EVENT } from '../../lib/wanted-handle.js';
import { DEMO_PAGE, DEMO_QA } from './demo.js';
import { Device } from './Device.js';
import styles from './hero.module.css';

const THINK_MS = 650;
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
  const screen = useRef<HTMLDivElement>(null);

  const questions = DEMO_QA.map((item) => item.q);

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
    // Keep the newest line in view inside the phone's own scroll box -- never
    // scrollIntoView, which would also move the landing page itself.
    const box = screen.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [shown, thinking]);

  function ask() {
    // The bar shows whichever question it has cycled to; asking that one is
    // what a visitor expects. AskBar keeps its index private, so read it from
    // the DOM it rendered rather than duplicate its timer here.
    const showing = document.querySelector('[data-hero-demo] [data-ask-bar]')?.textContent?.trim();
    const item = DEMO_QA.find((qa) => qa.q === showing) ?? DEMO_QA[round % DEMO_QA.length]!;
    setAsked(item);
    setTapped(true);
    setRound((r) => r + 1);
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
          <AskBar questions={questions} onOpen={ask} />
        </BentoPage>
      </div>
      </Device>
      <p className={styles.hint} aria-hidden="true">
        {hint}
      </p>
    </div>
  );
}
