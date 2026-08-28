'use client';

import { useEffect, useState, type FormEvent } from 'react';

/**
 * Slice 1 version: cycles real questions from this page's facts and posts one
 * question to the SSE route. The full sheet, streaming bubbles, and reduced
 * motion polish land with the design system in plan 2.
 */
export function AskBar({ handle, questions }: { handle: string; questions: string[] }) {
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    if (questions.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = setInterval(() => setIndex((i) => (i + 1) % questions.length), 4000);
    return () => clearInterval(timer);
  }, [questions.length]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setAnswer('');

    // A rejected fetch -- offline, DNS, a CORS regression -- throws rather
    // than resolving with response.ok === false. Uncaught, that becomes an
    // unhandled promise rejection and the visitor sees an empty box with no
    // explanation. Same user-facing copy as every other failure path here;
    // never show the visitor the raw error.
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/chat/${handle}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question }),
        },
      );

      if (!response.ok) {
        setAnswer('That answer failed. Try again.');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      // SSE events routinely straddle chunk boundaries, so the tail of one read
      // is carried over and prefixed onto the next rather than parsed as-is.
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        // { stream: true } holds back any multi-byte UTF-8 sequence cut in half
        // by this chunk boundary until the bytes that complete it arrive.
        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split('\n\n');
        buffer = segments.pop() ?? '';

        for (const segment of segments) {
          if (!segment.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(segment.slice(6)) as {
              type: string;
              text?: string;
              message?: string;
            };
            if (parsed.type === 'text' && parsed.text) setAnswer((a) => a + parsed.text);
            if (parsed.type === 'error') {
              // Replaces, not appends: a half-answer followed by an apology
              // reads worse than the apology alone.
              setAnswer(parsed.message ?? 'That answer failed. Try again.');
              return;
            }
            if (parsed.type === 'done') return;
          } catch {
            // A malformed or truncated payload is dropped; the stream continues.
          }
        }
      }
    } catch {
      setAnswer('That answer failed. Try again.');
    }
  }

  return (
    <form onSubmit={ask} style={{ position: 'sticky', bottom: 16, marginTop: 24 }}>
      {answer ? (
        <p style={{ background: 'var(--mint)', padding: 12, borderRadius: 10 }}>{answer}</p>
      ) : null}
      <input
        className="ask-bar"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={questions[index] ?? 'Ask anything'}
        aria-label="Ask a question about this page"
      />
    </form>
  );
}
