'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field } from '@curios/ui';
import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import styles from './knowledge.module.css';
import { EmptyState } from '../_ui/empty-state.js';

const NEW_FACT_ID = 'new-fact';
const toMessage = (failure: unknown) => (failure instanceof Error ? failure.message : 'Something failed. Try again.');
const title = (category: string) => category.charAt(0) + category.slice(1).toLowerCase();
const origin = (fact: KnowledgeFact) =>
  fact.origin === 'OWNER' ? 'Added by you' : fact.origin === 'UNTRACKED' ? 'Before tracking' : (fact.sourceLabel ?? 'A source');

function FactRow({
  fact,
  ownerFactMax,
  onEdit,
  onRemove,
}: {
  fact: KnowledgeFact;
  ownerFactMax: number;
  onEdit: (id: string, claim: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [draft, setDraft] = useState(fact.claim);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>, after: () => void) {
    setBusy(true);
    setError('');
    try {
      await action();
      after();
    } catch (failure) {
      setError(toMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.row}>
      {mode === 'edit' ? (
        <Field
          id={`fact-${fact.id}`}
          label="Fact"
          multiline
          hint={`One line, up to ${ownerFactMax} characters.`}
          value={draft}
          onChange={setDraft}
        />
      ) : (
        <p className={styles.label}>{fact.claim}</p>
      )}
      <p className={styles.meta}>{origin(fact)}</p>

      {mode === 'view' ? (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setMode('edit')}>Edit</Button>
          <Button variant="secondary" onClick={() => setMode('confirm')}>Remove</Button>
        </div>
      ) : mode === 'edit' ? (
        <div className={styles.actions}>
          <Button busy={busy} onClick={() => void run(() => onEdit(fact.id, draft), () => setMode('view'))}>Save</Button>
          <Button variant="secondary" onClick={() => { setDraft(fact.claim); setMode('view'); }}>Cancel</Button>
        </div>
      ) : (
        <div className={styles.confirm} role="group" aria-label="Confirm removal">
          <p>Remove this fact? The chat stops using it, and a re-read won’t bring it back.</p>
          <Button busy={busy} onClick={() => void run(() => onRemove(fact.id), () => setMode('view'))}>Remove fact</Button>
          <Button variant="secondary" onClick={() => setMode('view')}>Cancel</Button>
        </div>
      )}

      {error ? <Callout tone="error">{error}</Callout> : null}
    </li>
  );
}

export function FactList({
  facts,
  categories,
  ownerFactMax,
  onAdd,
  onEdit,
  onRemove,
  onChanged,
}: {
  facts: KnowledgeFact[];
  categories: FactCategory[];
  ownerFactMax: number;
  onAdd: (category: FactCategory, claim: string) => Promise<void>;
  onEdit: (id: string, claim: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [category, setCategory] = useState<FactCategory>(categories[0] ?? 'MISC');
  const [claim, setClaim] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onAdd(category, claim);
      setClaim('');
      onChanged();
    } catch (failure) {
      setError(toMessage(failure));
      // Add is natively disabled while busy, which drops focus; Field takes no ref, so find the input by id.
      document.getElementById(NEW_FACT_ID)?.focus();
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const shown = needle ? facts.filter((f) => f.claim.toLowerCase().includes(needle)) : facts;
  const groups = categories
    .map((c) => ({ category: c, facts: shown.filter((f) => f.category === c) }))
    .filter((g) => g.facts.length > 0);

  // Each row's own handlers wrap onChanged, so a success re-reads the server.
  const edit = async (id: string, text: string) => { await onEdit(id, text); onChanged(); };
  const remove = async (id: string) => { await onRemove(id); onChanged(); };

  return (
    <section>
      <form className={styles.add} onSubmit={(event) => void add(event)}>
        <label className={styles.select}>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as FactCategory)}>
            {categories.map((c) => <option key={c} value={c}>{title(c)}</option>)}
          </select>
        </label>
        <Field id={NEW_FACT_ID} label="A fact" value={claim} onChange={setClaim} hint={`One line, up to ${ownerFactMax} characters. Live straight away.`} />
        <Button type="submit" busy={busy}>Add</Button>
        {error ? <Callout tone="error">{error}</Callout> : null}
      </form>

      {/* Nothing to search until there is a fact: the empty state below says what to do instead. */}
      {facts.length > 0 ? (
        <input
          type="search"
          aria-label="Search facts"
          className={styles.search}
          placeholder="Search facts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}

      {facts.length === 0 ? (
        <EmptyState
          icon="facts"
          title="No facts yet"
          action={<a href="/app/knowledge?tab=sources">Add a source</a>}
        >
          Add one above, or add a source and accept its facts in Review.
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState icon="search" title="No facts match your search">
          Try another word, or clear the search to see them all.
        </EmptyState>
      ) : (
        groups.map((group) => (
          <div key={group.category}>
            <h2 className={styles.group}>{title(group.category)}</h2>
            <ul className={styles.list}>
              {group.facts.map((fact) => <FactRow key={fact.id} fact={fact} ownerFactMax={ownerFactMax} onEdit={edit} onRemove={remove} />)}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

export function Facts({ facts, categories, ownerFactMax }: { facts: KnowledgeFact[]; categories: FactCategory[]; ownerFactMax: number }) {
  const router = useRouter();
  return (
    <FactList
      facts={facts}
      categories={categories}
      ownerFactMax={ownerFactMax}
      onAdd={async (category, claim) => {
        await apiFetch('/facts', { method: 'POST', body: JSON.stringify({ category, claim }) });
      }}
      onEdit={async (id, claim) => {
        await apiFetch(`/facts/${id}`, { method: 'PATCH', body: JSON.stringify({ claim }) });
      }}
      onRemove={async (id) => {
        await apiFetch(`/facts/${id}/reject`, { method: 'POST' });
      }}
      onChanged={() => router.refresh()}
    />
  );
}
