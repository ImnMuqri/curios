'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import styles from './page.module.css';

/*
 * The budget lives here. FRONTEND.md: under 40KB before chat opens, and the
 * chat bundle loads on first interaction, never before. A static import of
 * chat mode would put the streaming parser and every bubble into the cold
 * page, which is the page a stranger on 4G actually waits for.
 */
// The subpath, NOT the '@curios/ui' barrel, so chat mode can be split from
// the cold page.
//
// Honest status: this still does not defer anything. It now produces a
// separate file -- webpack hoists chat mode into a shared chunk once the
// capture card joins it -- but that chunk is listed in the route's first load,
// so it downloads with the page regardless. The deferral this line describes
// remains an intention rather than a measured fact, and the route-chunk metric
// got smaller when the code moved without getting lighter, which is why
// budget.test.ts now also ratchets total first-load JS.
const ChatMode = dynamic(() => import('@curios/ui/chat').then((m) => m.ChatMode), {
  ssr: false,
});

export function Ask({
  handle,
  questions,
  displayName,
  canCapture,
  faqTotal = 0,
}: {
  handle: string;
  questions: string[];
  displayName: string;
  /** False for a personal page. The server refuses anyway; this stops the card being offered at all. */
  canCapture: boolean;
  /** How many answered questions the FAQ holds; with any, chat mode's greeting offers to browse them. */
  faqTotal?: number;
}) {
  const [open, setOpen] = useState(false);
  // Chat mode is mounted the first time it is opened, and never removed
  // again after that -- the whole point of the claude.ai treatment is that
  // the thread survives being hidden, and unmounting it on every close would
  // throw the conversation away along with the DOM.
  const [everOpened, setEverOpened] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  // Read by the tab listeners, which are attached once and would otherwise see the first render's value.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const onOpen = useCallback(() => {
    setEverOpened(true);
    setOpen(true);
  }, []);

  const onClose = useCallback(() => setOpen(false), []);

  /**
   * The page's Ask and Links tabs are server-rendered links (BentoPage), so
   * without JavaScript they still go somewhere. With it, Ask opens chat mode
   * in place and Links, while chat mode is open, goes back to the links --
   * through history.back(), so the entry chat mode pushed is the one consumed
   * and ChatMode's own popstate handler does the closing. `#ask` in the
   * address opens chat mode on arrival: the shop's Ask tab links here with it.
   */
  useEffect(() => {
    const page = promptRef.current?.closest<HTMLElement>('[data-bento-page]');
    if (!page) return;
    const askTab = page.querySelector<HTMLAnchorElement>('[data-tab="ask"]');
    const linksTab = page.querySelector<HTMLAnchorElement>('[data-tab="links"]');
    const toAsk = (event: MouseEvent) => {
      event.preventDefault();
      onOpen();
    };
    const toLinks = (event: MouseEvent) => {
      if (!openRef.current) return;
      event.preventDefault();
      history.back();
    };
    askTab?.addEventListener('click', toAsk);
    linksTab?.addEventListener('click', toLinks);
    if (window.location.hash === '#ask') onOpen();
    return () => {
      askTab?.removeEventListener('click', toAsk);
      linksTab?.removeEventListener('click', toLinks);
    };
  }, [onOpen]);

  // The current tab follows chat mode, for the eye (the filled pill) and for a screen reader alike.
  useEffect(() => {
    const page = promptRef.current?.closest<HTMLElement>('[data-bento-page]');
    if (!page) return;
    for (const tab of page.querySelectorAll<HTMLElement>('[data-tab]')) {
      const current = tab.dataset.tab === (open ? 'ask' : 'links');
      if (current) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }, [open]);

  /**
   * Focus follows the visitor back to what they tapped, the Ask tab -- without
   * this, Tab from a just-closed chat mode lands wherever it happened to be.
   * Done from an effect, on the true -> false edge, rather than inside
   * `onClose` itself, so it runs after `ChatMode` has taken `data-mode` off
   * the page in its own effect for the same commit (a child's effects run
   * before its parent's).
   *
   * There is no ask bar on the Links tab: the Public board has the Ask tab
   * as the one way into the chat, and its composer only there.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      promptRef.current?.closest<HTMLElement>('[data-bento-page]')?.querySelector<HTMLElement>('[data-tab="ask"]')?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Stable across renders: the streaming loop reads this after awaits, so a
  // fresh function every render would not itself break anything here, but
  // matches the shape onCapture below needs for the same reason.
  const onAsk = useCallback(
    async (question: string, conversationId: string | null) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/chat/${handle}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Omitted rather than sent as null: the route's schema marks it
          // optional, and null is not undefined to zod.
          body: JSON.stringify(
            conversationId === null ? { question } : { question, conversationId },
          ),
        },
      );
      if (!response.ok) return null;
      return response.body;
    },
    [handle],
  );

  const onCapture = useCallback(async (phone: string, conversationId: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/leads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, phone, consent: true }),
      },
    );

    if (!response.ok) {
      // The API's own message, verbatim: it says which number format works, or
      // that the shop already has this one. Rewriting it here would swap
      // instruction for apology.
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? 'That failed. Try again.');
    }
  }, []);

  return (
    <>
      {/*
        Moved here from page.tsx: this text now doubles as chat mode's own
        empty-state greeting (FRONTEND.md's amendment), which means whether
        it shows depends on client state -- whether a turn exists yet -- that
        a server component cannot hold. `data-ask-prompt` is the hook
        Bento.module.css hides it through once `[data-has-turns]` is set;
        server-rendered regardless, so a no-JS visitor still sees it, same as
        before.
      */}
      <div ref={promptRef} className={styles.greeting} data-ask-prompt>
        <p className={styles.askPrompt}>What do you want to know?</p>
        {faqTotal > 0 ? (
          <a className={styles.browse} href={`/${handle}/faq`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" />
            </svg>
            Browse {faqTotal} answered {faqTotal === 1 ? 'question' : 'questions'}
            <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
      {everOpened ? (
        <ChatMode
          open={open}
          onClose={onClose}
          onAsk={onAsk}
          displayName={displayName}
          questions={questions}
          // Omitted on a personal page, so the card is never offered there.
          // The server refuses one anyway; this stops it being asked for.
          onCapture={canCapture ? onCapture : undefined}
        />
      ) : null}
    </>
  );
}
