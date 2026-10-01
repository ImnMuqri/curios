import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { KnowledgeTabs, parseTab } from './tabs.js';

describe('parseTab', () => {
  it('reads a known tab and defaults to facts', () => {
    expect(parseTab('sources')).toBe('sources');
    expect(parseTab('never-say')).toBe('never-say');
    expect(parseTab(undefined)).toBe('facts');
    expect(parseTab('nonsense')).toBe('facts');
    expect(parseTab(['pinned', 'facts'])).toBe('pinned');
  });
});

describe('KnowledgeTabs', () => {
  it('links each tab by its address and marks the current one', () => {
    render(<KnowledgeTabs current="pinned" />);
    const nav = screen.getByRole('navigation', { name: 'Knowledge' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Facts', '/app/knowledge?tab=facts'],
      ['Sources', '/app/knowledge?tab=sources'],
      ['Pinned answers', '/app/knowledge?tab=pinned'],
      ['Never say', '/app/knowledge?tab=never-say'],
    ]);
    expect(screen.getByRole('link', { name: 'Pinned answers' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Facts' })).not.toHaveAttribute('aria-current');
  });
});
