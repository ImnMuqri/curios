'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AskBar } from '@curios/ui';
import styles from './page.module.css';

/*
 * The budget lives here. FRONTEND.md: under 40KB before chat opens, and the
 * chat bundle loads on first interaction, never before. A static import of
 * chat mode would put the streaming parser and every bubble into the cold
 * page, which is the page a stranger on 4G actually waits for.
 */
// The subpath, NOT the '@curios/ui' barrel: AskBar above is imported from that
// barrel statically, so a dynamic import of the same barrel gives webpack
// nothing to defer.
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
}: {
  handle: string;
  questions: string[];
  displayName: string;
  /** False for a personal page. The server refuses anyway; this stops the card being offered at all. */
  canCapture: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Chat mode is mounted the first time it is opened, and never removed
  // again after that -- the whole point of the claude.ai treatment is that
  // the thread survives being hidden, and unmounting it on every close would
  // throw the conversation away along with the DOM.
  const [everOpened, setEverOpened] = useState(false);
  const askBarRef = useRef<HTMLButtonElement>(null);

  const onOpen = useCallback(() => {
    setEverOpened(true);
    setOpen(true);
  }, []);

  const onClose = useCallback(() => setOpen(false), []);

  /**
   * Focus follows the visitor back to what they tapped -- without this, Tab
   * from a just-closed chat mode lands wherever it happened to be before the
   * bar was ever touched. Done from an effect, on the true -> false edge,
   * rather than inside `onClose` itself: the ask bar is hidden by a CSS rule
   * keyed on `data-mode`, which `ChatMode` removes from its own effect on the
   * very same `open` transition. Calling `.focus()` synchronously inside
   * `onClose` would run before either effect has fired -- while the bar is
   * still `display: none` under the old attribute value -- and silently
   * fail. Ordering `ChatMode`'s effect before this one (a child's effects run
   * before its parent's, for the same commit) is what makes waiting for the
   * next effect pass enough.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) askBarRef.current?.focus();
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
      <p className={styles.askPrompt} data-ask-prompt>
        What do you want to know?
      </p>
      <AskBar ref={askBarRef} questions={questions} onOpen={onOpen} />
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
