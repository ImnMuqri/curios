'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AskBar } from '@curios/ui';

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
  avatarUrl,
  canCapture,
}: {
  handle: string;
  questions: string[];
  displayName: string;
  avatarUrl?: string | null;
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

  const onClose = useCallback(() => {
    setOpen(false);
    // Focus follows the visitor back to what they tapped -- without this,
    // Tab from a just-closed chat mode lands wherever it happened to be
    // before the bar was ever touched.
    askBarRef.current?.focus();
  }, []);

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
      <AskBar ref={askBarRef} questions={questions} onOpen={onOpen} />
      {everOpened ? (
        <ChatMode
          open={open}
          onClose={onClose}
          onAsk={onAsk}
          displayName={displayName}
          avatarUrl={avatarUrl}
          questions={questions}
          // Omitted on a personal page, so the card is never offered there.
          // The server refuses one anyway; this stops it being asked for.
          onCapture={canCapture ? onCapture : undefined}
        />
      ) : null}
    </>
  );
}
