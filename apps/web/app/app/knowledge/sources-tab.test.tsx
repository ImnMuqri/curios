import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    addForm: <p>the add form</p>,
    onRemove: vi.fn().mockResolvedValue({ removedFacts: 12 }),
    onRecheck: vi.fn().mockResolvedValue(undefined),
    fetchStatus: vi.fn().mockResolvedValue({ status: 'RUNNING', extractedCount: 0, error: null }),
    onChanged: vi.fn(),
    ...handlers,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SourceList {...props} /></QueryClientProvider>);
  return props;
}

const row = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

describe('SourceList', () => {
  it('opens the add form from its button', async () => {
    list([site]);
    expect(screen.queryByText('the add form')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add a source' }));
    expect(screen.getByText('the add form')).toBeInTheDocument();
  });

  it('shows each source with its fact count', () => {
    list([site, pasted]);
    expect(within(row('https://nadia.example/')).getByText(/12 facts/)).toBeInTheDocument();
    expect(within(row('About Nadia Bakes')).getByText(/3 facts/)).toBeInTheDocument();
  });

  it('offers Check for new facts on links only, and says what it does not do', () => {
    list([site, pasted]);
    expect(within(row('https://nadia.example/')).getByRole('button', { name: 'Check for new facts' })).toBeInTheDocument();
    expect(within(row('https://nadia.example/')).getByText(/doesn’t remove ones the site has dropped/i)).toBeInTheDocument();
    expect(within(row('About Nadia Bakes')).queryByRole('button', { name: 'Check for new facts' })).toBeNull();
  });

  it('asks before removing, naming the count and the shared-fact loss', async () => {
    const { onRemove } = list([site]);
    await userEvent.click(within(row('https://nadia.example/')).getByRole('button', { name: 'Remove' }));

    expect(screen.getByText(/remove this source and its 12 facts\?/i)).toBeInTheDocument();
    expect(screen.getByText(/facts another source also says are removed too/i)).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Remove source' }));
    expect(onRemove).toHaveBeenCalledWith('s1');
  });

  it('cancels a removal', async () => {
    const { onRemove } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText(/remove this source/i)).toBeNull();
  });

  it('says a pre-tracking source removes only its entry', async () => {
    list([old]);
    expect(within(row('https://old.example/')).getByText(/facts from before tracking are listed under facts/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/removes the entry only/i)).toBeInTheDocument();
  });

  it('shows a source being read, with no actions on it', () => {
    list([reading]);
    const r = row('https://nadia.example/');
    expect(within(r).getByText(/reading/i)).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(r).queryByRole('button', { name: 'Check for new facts' })).toBeNull();
  });

  it('shows why a source failed, and still lets it be removed', () => {
    list([failed]);
    const r = row('https://nadia.example/');
    expect(within(r).getByText('We could not reach that site.')).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('refreshes after a removal', async () => {
    const { onChanged } = list([site]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove source' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a failure on its row, and keeps focus there', async () => {
    const onRecheck = vi.fn().mockRejectedValue(new Error('This source is still being read. Try again when it finishes.'));
    list([site], { onRecheck });
    const button = within(row('https://nadia.example/')).getByRole('button', { name: 'Check for new facts' });
    await userEvent.click(button);
    expect(within(row('https://nadia.example/')).getByText(/still being read/)).toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('has an empty state that points at adding one', () => {
    list([]);
    expect(screen.getByText(/no sources yet/i)).toBeInTheDocument();
  });

  it('says "1 fact", not "1 facts"', () => {
    list([{ ...site, factCount: 1 }]);
    expect(within(row('https://nadia.example/')).getByText(/ 1 fact(?!s)/)).toBeInTheDocument();
  });

  it('keeps the confirmation open and shows the reason when a removal fails', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('This source is still being read. Try again when it finishes.'));
    const { onChanged } = list([site], { onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove source' }));
    expect(within(row('https://nadia.example/')).getByText(/still being read/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove source' })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('clears an earlier failure when the action is tried again', async () => {
    const onRecheck = vi.fn().mockRejectedValueOnce(new Error('Not now.')).mockResolvedValueOnce(undefined);
    list([site], { onRecheck });
    const button = within(row('https://nadia.example/')).getByRole('button', { name: 'Check for new facts' });
    await userEvent.click(button);
    expect(await screen.findByText('Not now.')).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.queryByText('Not now.')).toBeNull();
  });
});
