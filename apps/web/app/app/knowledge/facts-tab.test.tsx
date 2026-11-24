import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FactCategory } from '@curios/core';
import type { KnowledgeFact } from '@curios/db-read';
import { ADD_FACT_EVENT, FactList, factSource } from './facts-tab.js';

const facts: KnowledgeFact[] = [
  { id: 'f1', category: 'PRICE', claim: 'Kek RM95.', origin: 'EXTRACTED', sourceLabel: 'https://nadia.example/menu/' },
  { id: 'f2', category: 'HOURS', claim: 'Closed Sunday.', origin: 'OWNER', sourceLabel: null },
  { id: 'f3', category: 'HOURS', claim: 'Open 9 to 5.', origin: 'UNTRACKED', sourceLabel: null },
  { id: 'f4', category: 'PERSON', claim: 'Baking since 2019.', origin: 'EXTRACTED', sourceLabel: 'Raya 2026 order list' },
];

function list(overrides: Partial<Parameters<typeof FactList>[0]> = {}) {
  const props = {
    facts,
    categories: ['PRICE', 'HOURS', 'PERSON', 'MISC'] as FactCategory[],
    ownerFactMax: 500,
    onAdd: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(),
    ...overrides,
  };
  render(<FactList {...props} />);
  return props;
}

const card = (claim: string) => screen.getByText(claim).closest('[role="row"]') as HTMLElement;

/** Open a fact's "···" menu and choose an item. */
async function choose(claim: string, item: 'Edit' | 'Remove') {
  await userEvent.click(within(card(claim)).getByRole('button', { name: 'More actions for this fact' }));
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
}

async function openAdd() {
  // The header's "+ Add a fact" (head-actions.tsx) asks the open tab by event.
  act(() => {
    window.dispatchEvent(new Event(ADD_FACT_EVENT));
  });
}

describe('FactList', () => {
  it('lists the facts as one table: Topic, Fact, From', () => {
    list();
    const table = screen.getByRole('table', { name: 'Your facts' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Topic', 'Fact', 'From', 'Actions']);
    expect(within(card('Kek RM95.')).getByText('Price')).toBeInTheDocument();
    expect(within(card('Baking since 2019.')).getByText('About you')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hours' })).toBeNull();
  });

  it('labels each fact by where it came from, in the board’s words', () => {
    list();
    expect(within(card('Kek RM95.')).getByRole('link', { name: 'Menu page' })).toHaveAttribute('href', 'https://nadia.example/menu/');
    expect(within(card('Closed Sunday.')).getByText('You wrote this')).toBeInTheDocument();
    expect(within(card('Open 9 to 5.')).getByText('Source not recorded')).toBeInTheDocument();
    expect(within(card('Baking since 2019.')).getByText('Pasted text')).toBeInTheDocument();
  });

  it('names a source from its address, file name or text', () => {
    const from = (sourceLabel: string | null, origin: KnowledgeFact['origin'] = 'EXTRACTED') => factSource({ id: 'x', category: 'MISC', claim: 'c', origin, sourceLabel });
    expect(from('https://www.instagram.com/kek.lina/').label).toBe('Instagram bio');
    expect(from('https://www.instagram.com/p/Cxyz/').label).toBe('Instagram post');
    expect(from('https://tiktok.com/@kek').label).toBe('TikTok profile');
    expect(from('https://keklina.example/harga').label).toBe('Menu page');
    expect(from('https://keklina.example/about').label).toBe('keklina.example/about');
    // Whole segments only: a word inside one is not a menu page.
    expect(from('https://keklina.example/border').label).toBe('keklina.example/border');
    expect(from('https://keklina.example/workshop').label).toBe('keklina.example/workshop');
    expect(from('https://keklina.example/products/x').label).toBe('keklina.example/products/x');
    expect(from('https://keklina.example/order-status').label).toBe('keklina.example/order-status');
    expect(from('https://keklina.example/en/Menu/').label).toBe('Menu page');
    // A label cut at its limit is not the page's address, so it is not linked.
    expect(from(`https://keklina.example/menu/${'a'.repeat(60)}…`).href).toBeUndefined();
    expect(from('https://keklina.example/menu').href).toBe('https://keklina.example/menu');
    expect(from('Raya-menu-2026.pdf').label).toBe('Raya-menu-2026.pdf');
    expect(from(null).label).toBe('Source removed');
  });

  it('filters by kind, counting each, and offers only kinds that have facts', async () => {
    list();
    const show = screen.getByRole('group', { name: 'Show' });
    expect(within(show).getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(show).queryByRole('button', { name: /Other/ })).toBeNull();

    await userEvent.click(within(show).getByRole('button', { name: 'Hours 2' }));
    expect(screen.queryByText('Kek RM95.')).toBeNull();
    expect(screen.getByText('Closed Sunday.')).toBeInTheDocument();
  });

  it('adds a fact with its kind, trusted straight away', async () => {
    const { onAdd, onChanged } = list();
    await openAdd();
    expect(screen.getByText(/trusted straight away/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }));
    await userEvent.type(screen.getByLabelText('New fact'), 'Parking at the back.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith('MISC', 'Parking at the back.');
    expect(onChanged).toHaveBeenCalled();
    // The line closes, and says so.
    expect(screen.queryByLabelText('New fact')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Added. The chat can use it now.');
  });

  it('starts a new fact in the kind being shown', async () => {
    list();
    await userEvent.click(screen.getByRole('button', { name: 'Hours 2' }));
    await openAdd();
    expect(screen.getByRole('radio', { name: 'Hours' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps what the owner typed when adding fails, says why, and puts focus back', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('You already have a fact that says this.'));
    const { onChanged } = list({ onAdd });
    await openAdd();
    await userEvent.type(screen.getByLabelText('New fact'), 'Kek RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a fact that says this.');
    expect(screen.getByLabelText('New fact')).toHaveValue('Kek RM95.');
    expect(screen.getByLabelText('New fact')).toHaveFocus();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('can open with the add line showing', () => {
    list({ startAdding: true });
    expect(screen.getByLabelText('New fact')).toHaveFocus();
  });

  it('edits a fact in place', async () => {
    const { onEdit, onChanged } = list();
    await choose('Kek RM95.', 'Edit');
    const field = screen.getByRole('textbox', { name: 'Edit fact' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Kek RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('f1', 'Kek RM99.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the draft and says why when saving an edit fails', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('That is not a usable fact.'));
    const { onChanged } = list({ onEdit });
    await choose('Kek RM95.', 'Edit');
    const field = screen.getByRole('textbox', { name: 'Edit fact' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Kek RM99.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('That is not a usable fact.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Kek RM99.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('cancelling an edit restores the original claim', async () => {
    const { onEdit } = list();
    await choose('Kek RM95.', 'Edit');
    await userEvent.type(screen.getByDisplayValue('Kek RM95.'), ' extra');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onEdit).not.toHaveBeenCalled();
    await choose('Kek RM95.', 'Edit');
    expect(screen.getByDisplayValue('Kek RM95.')).toBeInTheDocument();
  });

  it('removes a fact only after confirming, and Keep keeps it', async () => {
    const { onRemove, onChanged } = list();
    await choose('Kek RM95.', 'Remove');
    expect(screen.getByText(/a re-read won’t bring it back/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Kek RM95.')).toBeInTheDocument();

    await choose('Kek RM95.', 'Remove');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('f1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('says why when removing fails, and keeps the fact', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('A re-check is running. Try again shortly.'));
    const { onChanged } = list({ onRemove });
    await choose('Kek RM95.', 'Remove');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('A re-check is running. Try again shortly.')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('filters by search', async () => {
    list();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search facts' }), 'sunday');
    expect(screen.queryByText('Kek RM95.')).toBeNull();
    expect(screen.getByText('Closed Sunday.')).toBeInTheDocument();
  });

  it('says so when a search matches nothing, and keeps the no-facts message for no facts', async () => {
    list();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search facts' }), 'zzzz');
    expect(screen.getByText('No facts match. Try another word.')).toBeInTheDocument();
    expect(screen.queryByText(/knows nothing yet/i)).toBeNull();
  });

  it('has an empty state that offers a source or a fact of your own', async () => {
    list({ facts: [] });
    expect(screen.getByText(/your page knows nothing yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a source' })).toHaveAttribute('href', '/app/knowledge?tab=sources&add=1');
    await userEvent.click(screen.getByRole('button', { name: 'Write a fact' }));
    expect(screen.getByLabelText('New fact')).toBeInTheDocument();
  });
});

describe('removing', () => {
  const props = () => ({
    categories: ['PRICE', 'HOURS', 'PERSON', 'MISC'] as FactCategory[],
    ownerFactMax: 500,
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(),
  });
  const more = (claim: string) => within(card(claim)).getByRole('button', { name: 'More actions for this fact' });

  async function removeFirst(rest: KnowledgeFact[]) {
    const p = props();
    const { rerender } = render(<FactList {...p} facts={facts} />);
    await choose('Kek RM95.', 'Remove');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    rerender(<FactList {...p} facts={rest} />);
  }

  it('moves focus to the next row’s menu button', async () => {
    await removeFirst(facts.slice(1));
    expect(more('Closed Sunday.')).toHaveFocus();
  });

  it('moves focus to the previous row when the last one goes', async () => {
    const p = props();
    const { rerender } = render(<FactList {...p} facts={facts} />);
    await choose('Baking since 2019.', 'Remove');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    rerender(<FactList {...p} facts={facts.slice(0, 3)} />);
    expect(more('Open 9 to 5.')).toHaveFocus();
  });

  it('leaves the empty state, not a stray focus, when the last fact goes', async () => {
    const p = props();
    const { rerender } = render(<FactList {...p} facts={facts.slice(0, 1)} />);
    await choose('Kek RM95.', 'Remove');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    rerender(<FactList {...p} facts={[]} />);
    // No facts left shows the empty state, which has no search; focus then has nowhere better to go.
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});

describe('the row menu', () => {
  const button = (claim: string) => within(card(claim)).getByRole('button', { name: 'More actions for this fact' });

  it('is a menu button that opens Edit and Remove', async () => {
    list();
    const more = button('Kek RM95.');
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Remove']);
  });

  it('opens from the keyboard onto the first item, moves with the arrows, and Escape returns focus', async () => {
    list();
    const more = button('Kek RM95.');
    more.focus();
    await userEvent.keyboard('{ArrowDown}');
    const [edit, remove] = screen.getAllByRole('menuitem');
    expect(edit).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(remove).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(edit).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(remove).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens with Enter onto the first item', async () => {
    list();
    button('Kek RM95.').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('opens with a click and leaves focus on the button', async () => {
    list();
    await userEvent.click(button('Kek RM95.'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).not.toHaveFocus();
  });

  it('opens onto the last item with the up arrow, and closes on a click away', async () => {
    list();
    button('Kek RM95.').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('gives focus back to the menu button when an edit is cancelled', async () => {
    list();
    await choose('Kek RM95.', 'Edit');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(button('Kek RM95.')).toHaveFocus();
  });
});

describe('knowledge.module.css widths', () => {
  const css = readFileSync(join(import.meta.dirname, 'knowledge.module.css'), 'utf8').replace(/\r/g, '');
  const rule = (name: string) => css.slice(css.indexOf('\n' + name + ' {')).split('}')[0] ?? '';

  it('lets the facts table span the whole column, the Fact column taking the extra', () => {
    expect(rule('.wrap')).not.toMatch(/max-width/);
    expect(css).toMatch(/grid-template-columns: 120px minmax\(0, 1fr\) minmax\(0, 220px\) 32px;/);
  });

  it('keeps a reading width only for the prose tabs', () => {
    expect(rule('.wrapRead')).toMatch(/max-width: 820px;/);
    for (const f of ['pinned-tab.tsx', 'never-say-tab.tsx']) expect(readFileSync(join(import.meta.dirname, f), 'utf8')).toContain('styles.wrapRead');
    for (const f of ['facts-tab.tsx', 'sources-tab.tsx']) expect(readFileSync(join(import.meta.dirname, f), 'utf8')).not.toContain('wrapRead');
  });
});
