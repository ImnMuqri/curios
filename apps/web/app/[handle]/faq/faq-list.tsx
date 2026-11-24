'use client';

import { useState } from 'react';
import { excerpt, faqCopy } from './faq-copy.js';
import styles from './faq.module.css';

/**
 * The questions with the start of each answer (More board, cfaqi), and a search over them. Rendered on the
 * server too, so the whole list is there without JavaScript; the search only narrows it. No "N asked": the
 * board shows answers, not counts.
 */
export function FaqList({
  handle,
  displayName,
  entries,
  language,
}: {
  handle: string;
  displayName: string;
  entries: { slug: string; question: string; answer: string }[];
  /** The page's language. The copy holds functions, which a server page can't hand to a client component. */
  language: string | undefined;
}) {
  const copy = faqCopy(language);
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
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder} />
      </label>
      {shown.length > 0 ? (
        <ul className={styles.rows}>
          {shown.map((entry) => (
            <li key={entry.slug}>
              <a className={styles.row} href={`/${handle}/faq/${entry.slug}`}>
                <b>{entry.question}</b>
                <small>{excerpt(entry.answer)}</small>
                <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.none}>
          <b>{copy.nothingMatches}</b>
          <p>{copy.nothingBody(displayName)}</p>
          <a className={styles.lite} href={`/${handle}#ask`}>
            {copy.askName(displayName)}
          </a>
        </div>
      )}
    </>
  );
}
