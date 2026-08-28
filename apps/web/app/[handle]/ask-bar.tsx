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

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/chat/${handle}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      },
    );

    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n\n')) {
        if (!line.startsWith('data: ')) continue;
        const event_ = JSON.parse(line.slice(6)) as { type: string; text?: string };
        if (event_.type === 'text' && event_.text) setAnswer((a) => a + event_.text);
      }
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
