import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeSource } from '@curios/db-read';
import { SourceList } from './sources-tab.js';

const at = new Date('2026-09-28T10:00:00Z');
const site: KnowledgeSource = { id: 's1', sourceUrl: 'https://nadia.example/', label: 'https://nadia.example/', status: 'SUCCEEDED', error: null, tracked: true, factCount: 12, createdAt: at };
const pasted: KnowledgeSource = { id: 's2', sourceUrl: null, label: 'About Nadia Bakes', status: 'SUCCEEDED', error: null, tracked: true, factCount: 3, createdAt: at };
const old: KnowledgeSource = { id: 's3', sourceUrl: 'https://old.example/', label: 'https://old.example/', status: 'SUCCEEDED', error: null, tracked: false, factCount: 0, createdAt: at };
const reading: KnowledgeSource = { ...site, id: 's4', status: 'RUNNING', factCount: 0 };
const failed: KnowledgeSource = { ...site, id: 's5', status: 'FAILED', error: 'We could not reach that site.' };

function list(sources: KnowledgeSource[], handlers: Partial<Parameters<typeof SourceList>[0]> = {}) {
  const props = {
    sources,
    pageId: 'p1',
    pastedTextMax: 20_000,
    onAdd: vi.fn().mockResolvedValue({ ingestionId: 'new-1' }),
    onRemove: vi.fn().mockResolvedValue({ removedFacts: 12 }),
    onRecheck: vi.fn().mockResolvedValue(undefined),
    fetchStatus: vi.fn().mockResolvedValue({ status: 'RUNNING', extractedCount: 0, progress: 37, error: null }),
    onChanged: vi.fn(),
    ...handlers,
  };
  render(<SourceList {...props} />);
  return props;
}

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('SourceList', () => {
  it('reads a link from the add form', async () => {
    const { onAdd, onChanged } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a source' }));
    await userEvent.type(screen.getByLabelText('Link to read'), 'https://nadia.example/menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(onAdd).toHaveBeenCalledWith({ pageId: 'p1', sourceUrl: 'https://nadia.example/menu' });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByLabelText('Link to read')).toBeNull();
    // The board says nothing here: the new source's own row shows it reading.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('reads pasted text, and refuses an empty paste before sending it', async () => {
    const { onAdd } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a source' }));
    await userEvent.click(screen.getByRole('button', { name: 'Paste text' }));
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/paste something first/i);
    expect(onAdd).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Text to read'), 'Kek butter RM95.');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(onAdd).toHaveBeenCalledWith({ pageId: 'p1', pastedText: 'Kek butter RM95.' });
  });

  it('turns a login-walled link into a paste, and says why', async () => {
    const { onAdd } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: '+ Add a source' }));
    await userEvent.type(screen.getByLabelText('Link to read'), 'https://www.instagram.com/nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Text to read')).toBeInTheDocument();
    expect(screen.getByText(/does not let us read profiles/i)).toBeInTheDocument();
  });

  it('keeps the form and says why when starting fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Too many reads today. Try again tomorrow.'));
    const { onChanged } = list([site], { onAdd });
    await userEvent.click(screen.getByRole('button', { name: '+ Add a source' }));
    await userEvent.type(screen.getByLabelText('Link to read'), 'https://nadia.example/menu');
    await userEvent.click(screen.getByRole('button', { name: 'Read it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reads today.');
    expect(screen.getByLabelText('Link to read')).toHaveValue('https://nadia.example/menu');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('can open with the form showing', () => {
    list([site], { startAdding: true });
    expect(screen.getByLabelText('Link to read')).toHaveFocus();
  });

  it('shows each source with what it is, when it came, and its fact count', () => {
    list([site, pasted]);
    const s = row('nadia.example');
    expect(within(s).getByText(/^Link · added 28 Sep/)).toBeInTheDocument();
    expect(within(s).getByText('12')).toBeInTheDocument();
    expect(within(row('About Nadia Bakes')).getByText(/^Pasted text · added/)).toBeInTheDocument();
  });

  it('says "1 fact", not "1 facts"', () => {
    list([{ ...site, factCount: 1 }]);
    expect(within(row('nadia.example')).getByText('fact')).toBeInTheDocument();
  });

  it('offers to read links again, never pasted text', () => {
    list([site, pasted]);
    expect(within(row('nadia.example')).getByRole('button', { name: 'Read nadia.example again' })).toBeInTheDocument();
    expect(within(row('About Nadia Bakes')).queryByRole('button', { name: /again/ })).toBeNull();
  });

  it('reads a link again, shows it being read, and says so', async () => {
    const { onRecheck, onChanged } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: 'Read nadia.example again' }));
    expect(onRecheck).toHaveBeenCalledWith('s1');
    expect(onChanged).toHaveBeenCalled();
    expect(within(row('nadia.example')).getByText(/^Reading…/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reading nadia.example again. New facts go to Review.');
    // As far as its poll says it has got.
    expect(await within(row('nadia.example')).findByText('Reading… 37%')).toBeInTheDocument();
  });

  it('asks before removing, naming the count and the shared-fact loss', async () => {
    const { onRemove, onChanged } = list([site]);
    await userEvent.click(within(row('nadia.example')).getByRole('button', { name: 'Remove nadia.example' }));
    expect(screen.getByText(/remove it and its 12 facts\?/i)).toBeInTheDocument();
    expect(screen.getByText(/facts another source also says are removed too/i)).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('s1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps a source when Keep is chosen', async () => {
    const { onRemove } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove nadia.example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText(/remove it and its/i)).toBeNull();
  });

  it('says a pre-tracking source removes only its entry', async () => {
    list([old]);
    expect(within(row('old.example')).getByText(/facts from before tracking are listed under facts/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove old.example' }));
    expect(screen.getByText(/its older facts stay under facts/i)).toBeInTheDocument();
  });

  it('shows a source being read, with no actions on it', () => {
    list([reading]);
    const r = row('nadia.example');
    expect(within(r).getByText(/^Reading…/)).toBeInTheDocument();
    expect(within(r).queryByRole('button')).toBeNull();
  });

  it('re-reads the list when a reading row finishes, and says what it found', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 3, progress: 100, error: null });
    const { onChanged } = list([reading], { fetchStatus });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByText('3 new facts are waiting for you.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Review' })).toHaveAttribute('href', '/app/review');
  });

  it('does not re-read while a row is still reading', async () => {
    const { onChanged, fetchStatus } = list([reading]);
    await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('words a re-check that finds nothing new as nothing new, only for a source that had facts', async () => {
    const none = vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 0, progress: 100, error: null });
    list([reading, { ...reading, id: 's6', sourceUrl: 'https://first.example/', label: 'https://first.example/', tracked: true, factCount: 5 }], { fetchStatus: none });
    expect(await screen.findByText(/no new facts/i)).toBeInTheDocument();
    expect(screen.getAllByText(/nothing to use there/i)).toHaveLength(1);
  });

  it('shows why a source failed, and still lets it be removed', () => {
    list([failed]);
    const r = row('nadia.example');
    expect(within(r).getByText('We could not reach that site.')).toBeInTheDocument();
    expect(within(r).getByText(/^Could not read it/)).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Remove nadia.example' })).toBeInTheDocument();
  });

  it('shows a failure on its row', async () => {
    const onRecheck = vi.fn().mockRejectedValue(new Error('This source is still being read. Try again when it finishes.'));
    list([site], { onRecheck });
    await userEvent.click(within(row('nadia.example')).getByRole('button', { name: 'Read nadia.example again' }));
    expect(within(row('nadia.example')).getByRole('alert')).toHaveTextContent(/still being read/);
  });

  it('keeps the confirmation open and shows the reason when a removal fails', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('This source is still being read. Try again when it finishes.'));
    const { onChanged } = list([site], { onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'Remove nadia.example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(within(row('nadia.example')).getByText(/still being read/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('clears an earlier failure when the action is tried again', async () => {
    const onRecheck = vi.fn().mockRejectedValueOnce(new Error('Not now.')).mockResolvedValueOnce(undefined);
    list([site], { onRecheck });
    await userEvent.click(within(row('nadia.example')).getByRole('button', { name: 'Read nadia.example again' }));
    expect(await screen.findByText('Not now.')).toBeInTheDocument();
    await userEvent.click(within(row('nadia.example')).getByRole('button', { name: 'Read nadia.example again' }));
    expect(screen.queryByText('Not now.')).toBeNull();
  });

  it('has an empty state that points at adding one', async () => {
    list([]);
    expect(screen.getByText(/no sources yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a source' }));
    expect(screen.getByLabelText('Link to read')).toBeInTheDocument();
  });

  it('shows the Malaysian date, not the UTC one the server ran in', () => {
    // 2026-09-27T20:00Z is 04:00 on 28 Sep in Malaysia. Unpinned, a UTC server
    // prints 27 Sep and the browser prints 28 Sep: a hydration mismatch.
    const originalTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      list([{ ...site, createdAt: new Date('2026-09-27T20:00:00Z') }]);
      const r = row('nadia.example');
      expect(within(r).getByText(/added 28 Sep(t)? 2026/)).toBeInTheDocument();
      expect(within(r).queryByText(/27 Sep(t)? 2026/)).toBeNull();
    } finally {
      // `= undefined` would store the string "undefined".
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
