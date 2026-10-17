'use client';

import { useState } from 'react';
import styles from './faq.module.css';

/**
 * The questions, with a search over them. Rendered on the server too, so the
 * whole list is there without JavaScript; the search only narrows it.
 */
export function FaqList({
  handle,
  displayName,
  entries,
}: {
  handle: string;
  displayName: string;
  entries: { slug: string; question: string; askCount: number }[];
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter((entry) => entry.question.toLowerCase().includes(needle)) : entries;

  return (
    <>
      <label className={styles.search}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions" aria-label="Search questions" />
      </label>
      {shown.length > 0 ? (
        <ul className={styles.list}>
          {shown.map((entry) => (
            <li key={entry.slug}>
              <a className={styles.question} href={`/${handle}/faq/${entry.slug}`}>
                <b>{entry.question}</b>
                <span className={styles.count}>{entry.askCount} asked</span>
                <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.none}>
          <b>Nothing matches</b>
          <p>Ask it on the page instead. {displayName}&rsquo;s page answers in a few seconds.</p>
          <a className={styles.lite} href={`/${handle}#ask`}>
            Ask {displayName}
          </a>
        </div>
      )}
    </>
  );
}
