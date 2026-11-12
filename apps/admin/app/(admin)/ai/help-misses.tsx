'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api.js';
import { ago } from '../ago.js';
import ui from '../ui.module.css';
import styles from './ai.module.css';

interface Miss {
  id: string;
  question: string;
  entry: { id: string; question: string } | null;
  screen: string;
  sentToSupport: boolean;
  createdAt: string;
  owner: { email: string; handle: string | null } | null;
}

/**
 * The latest questions the help guide failed: not in it, or answered and marked "No". Loaded from
 * the API in the browser, because the read-only role this app reads with cannot see whose question
 * it was or its words (as on Support). What to write the next guide entries from.
 */
export function HelpMisses({ now }: { now: Date }) {
  const [misses, setMisses] = useState<Miss[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    apiFetch<{ misses: Miss[] }>('/admin/help/misses')
      .then((r) => {
        if (!gone) setMisses(r.misses);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, []);

  if (failed) return <p className={ui.nothing}>The latest questions could not load.</p>;
  if (!misses) return <p className={ui.nothing}>Loading…</p>;
  if (misses.length === 0) return <p className={ui.nothing}>Nothing the guide missed yet.</p>;
  return (
    <>
      {misses.map((m) => (
        <div key={m.id} className={styles.tr}>
          <p>{m.question}</p>
          <small>
            {m.entry ? `Marked No · ${m.entry.question}` : 'Not in the guide'}
            {m.sentToSupport ? ' · sent to support' : ''}
            {m.owner ? ` · ${m.owner.handle ? `curios.my/${m.owner.handle}` : m.owner.email}` : ''} · {ago(new Date(m.createdAt), now)}
          </small>
        </div>
      ))}
    </>
  );
}
