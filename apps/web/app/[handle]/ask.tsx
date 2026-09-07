'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { AskBar } from '@curios/ui';

/*
 * The budget lives here. FRONTEND.md: under 40KB before chat opens, and the
 * chat bundle loads on first interaction, never before. A static import of the
 * sheet would put the streaming parser and every bubble into the cold page,
 * which is the page a stranger on 4G actually waits for.
 */
// The subpath, NOT the '@curios/ui' barrel: AskBar above is imported from that
// barrel statically, so a dynamic import of the same barrel gives webpack
// nothing to defer.
//
// Honest status: this does not currently produce a separate chunk. Grepping
// the built output for the sheet's own strings finds them inside
// app/[handle]/page-*.js, subpath and sideEffects declaration notwithstanding.
// It costs roughly 4 kB of a 7 kB route chunk, which is why chasing it further
// was not worth the time -- but the deferral this line describes is an
// intention, not a measured fact, and the next person should know that before
// trusting it with something larger.
const AskSheet = dynamic(() => import('@curios/ui/sheet').then((m) => m.AskSheet), {
  ssr: false,
});

export function Ask({ handle, questions }: { handle: string; questions: string[] }) {
  const [seed, setSeed] = useState<string | null>(null);

  // Stable across renders: AskSheet asks on mount and its effect depends on
  // this, so a fresh function every render would re-ask on every keystroke of
  // a streamed answer.
  const onAsk = useCallback(
    async (question: string) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/chat/${handle}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question }),
        },
      );
      if (!response.ok) return null;
      return response.body;
    },
    [handle],
  );

  return (
    <>
      <AskBar questions={questions} onOpen={setSeed} />
      {seed === null ? null : (
        <AskSheet seed={seed} onClose={() => setSeed(null)} onAsk={onAsk} />
      )}
    </>
  );
}
